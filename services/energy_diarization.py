"""Lightweight energy-based speaker diarization service.

This module provides a simple, dependency-light diarization backend that
relies only on ``numpy`` and the Python standard library's ``wave`` module.
It detects silence boundaries in the audio signal and assigns alternating
speaker labels at each boundary — a basic *turn-taking* heuristic.

While far less accurate than neural diarization models, this backend is
always available and can serve as a fallback or be used during testing.
"""

import logging
import os
import shutil
import struct
import subprocess
import tempfile
import wave
from typing import List, Optional

import numpy as np

from services.base import (
    DiarizationResult,
    DiarizationService,
    SpeakerSegment,
)

logger = logging.getLogger(__name__)


class EnergyDiarizationService(DiarizationService):
    """Energy / silence-based speaker diarization.

    The algorithm:

    1. Read the audio as PCM samples (mono, via the ``wave`` module).
    2. Compute short-time energy in fixed-length frames.
    3. Identify silence regions where the energy drops below a threshold.
    4. Treat each non-silent region between silences as a speech segment
       and assign alternating speaker labels (turn-taking heuristic).

    Args:
        frame_duration_ms: Length of each analysis frame in milliseconds.
        energy_threshold_ratio: Energy threshold as a fraction of the maximum
            frame energy.  Frames below this are considered silence.
        min_silence_duration: Minimum consecutive silence duration (seconds)
            required to trigger a speaker change.
        min_segment_duration: Segments shorter than this (seconds) are
            merged with their neighbour.
    """

    def __init__(
        self,
        frame_duration_ms: int = 30,
        energy_threshold_ratio: float = 0.02,
        min_silence_duration: float = 0.5,
        min_segment_duration: float = 0.3,
    ) -> None:
        self._frame_duration_ms = frame_duration_ms
        self._energy_threshold_ratio = energy_threshold_ratio
        self._min_silence_duration = min_silence_duration
        self._min_segment_duration = min_segment_duration

    # -- DiarizationService interface ----------------------------------------

    @property
    def name(self) -> str:  # noqa: D401
        return "energy"

    def is_available(self) -> bool:
        """Always returns *True* — no optional dependencies needed."""
        return True

    def diarize(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        speaker_names: Optional[List[str]] = None,
    ) -> DiarizationResult:
        """Segment *audio_path* using energy-based silence detection.

        Args:
            audio_path: Path to an audio file.  Non-WAV formats are
                automatically converted to WAV via *ffmpeg* if available.
            num_speakers: Number of speakers to assume (default ``2``).
            speaker_names: Optional display names for the speakers.

        Returns:
            A :class:`DiarizationResult`.

        Raises:
            ValueError: If the audio file cannot be read.
        """
        num_speakers = num_speakers or 2

        logger.info("Running energy-based diarization on %s …", audio_path)

        wav_path = self._ensure_wav(audio_path)
        converted = wav_path != audio_path
        try:
            samples, sample_rate = self._read_wav(wav_path)
        finally:
            if converted:
                try:
                    os.remove(wav_path)
                except OSError:
                    pass

        # Compute per-frame energy.
        frame_len = int(sample_rate * self._frame_duration_ms / 1000)
        if frame_len == 0:
            frame_len = 1
        energies = self._compute_frame_energies(samples, frame_len)

        # Determine silence threshold.
        max_energy = np.max(energies) if len(energies) > 0 else 1.0
        threshold = max_energy * self._energy_threshold_ratio

        # Build speech/silence mask.
        is_speech = energies > threshold

        # Group consecutive speech frames into raw segments.
        raw_segments = self._frames_to_segments(
            is_speech, frame_len, sample_rate
        )

        # Merge short segments.
        raw_segments = self._merge_short_segments(
            raw_segments, self._min_segment_duration
        )

        # Assign speakers via round-robin at silence boundaries.
        label_map: dict[str, str] = {}
        if speaker_names:
            for idx, custom in enumerate(speaker_names):
                label_map[f"SPEAKER_{idx}"] = custom

        segments: List[SpeakerSegment] = []
        for i, (start, end) in enumerate(raw_segments):
            generic = f"SPEAKER_{i % num_speakers}"
            display = label_map.get(generic, generic)
            segments.append(SpeakerSegment(speaker=display, start=start, end=end))

        unique_labels = sorted({s.speaker for s in segments})
        logger.info(
            "Energy diarization complete: %d segments, %d speakers.",
            len(segments),
            len(unique_labels),
        )
        return DiarizationResult(
            segments=segments,
            num_speakers=len(unique_labels),
            speaker_labels=unique_labels,
        )

    # -- Internal helpers ----------------------------------------------------

    @staticmethod
    def _ensure_wav(audio_path: str) -> str:
        """Return a path to a WAV version of *audio_path*.

        If the file is already a WAV file it is returned unchanged.
        Otherwise *ffmpeg* is used to transcode the file to a 16 kHz
        mono 16-bit WAV in a temporary location.  The caller is
        responsible for deleting the temporary file when it is no
        longer needed.

        Raises:
            ValueError: If the file is not WAV and *ffmpeg* is not
                available on the system ``PATH``.
        """
        # Quick sniff: WAV files start with "RIFF" at offset 0 and "WAVE" at offset 8.
        try:
            with open(audio_path, "rb") as f:
                header = f.read(12)
        except OSError as exc:
            raise ValueError(f"Cannot read audio file: {exc}") from exc

        if header[:4] == b"RIFF" and header[8:12] == b"WAVE":
            return audio_path

        # Non-WAV → convert with ffmpeg.
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg is None:
            raise ValueError(
                f"Audio file '{audio_path}' is not in WAV format and "
                "ffmpeg is not installed.  Install ffmpeg or convert "
                "the file to WAV before uploading."
            )

        fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-i", audio_path,
                    "-ar", "16000",
                    "-ac", "1",
                    "-acodec", "pcm_s16le",
                    wav_path,
                ],
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as exc:
            try:
                os.remove(wav_path)
            except OSError:
                pass
            stderr = exc.stderr.decode(errors="replace") if exc.stderr else ""
            raise ValueError(
                f"ffmpeg failed to convert '{audio_path}' to WAV: {stderr}"
            ) from exc

        return wav_path

    @staticmethod
    def _read_wav(audio_path: str) -> tuple:
        """Read a WAV file and return (samples_as_float_ndarray, sample_rate)."""
        with wave.open(audio_path, "rb") as wf:
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            sample_rate = wf.getframerate()
            n_frames = wf.getnframes()
            raw = wf.readframes(n_frames)

        # Unpack raw bytes to integers.
        fmt_map = {1: "b", 2: "h", 4: "i"}
        if sampwidth not in fmt_map:
            raise ValueError(f"Unsupported sample width: {sampwidth}")
        fmt = f"<{n_frames * n_channels}{fmt_map[sampwidth]}"
        int_samples = struct.unpack(fmt, raw)

        samples = np.array(int_samples, dtype=np.float64)
        # Down-mix to mono.
        if n_channels > 1:
            samples = samples.reshape(-1, n_channels).mean(axis=1)
        # Normalize to [-1, 1].
        max_val = float(2 ** (8 * sampwidth - 1))
        samples /= max_val
        return samples, sample_rate

    @staticmethod
    def _compute_frame_energies(
        samples: np.ndarray, frame_len: int
    ) -> np.ndarray:
        """Return the RMS energy for each non-overlapping frame."""
        n_frames = len(samples) // frame_len
        if n_frames == 0:
            return np.array([np.sqrt(np.mean(samples**2))]) if len(samples) > 0 else np.array([0.0])
        trimmed = samples[: n_frames * frame_len].reshape(n_frames, frame_len)
        return np.sqrt(np.mean(trimmed**2, axis=1))

    @staticmethod
    def _frames_to_segments(
        is_speech: np.ndarray,
        frame_len: int,
        sample_rate: int,
    ) -> List[tuple]:
        """Convert a boolean speech mask to a list of ``(start, end)`` tuples."""
        segments: List[tuple] = []
        in_segment = False
        seg_start = 0.0

        frame_dur = frame_len / sample_rate

        for i, voiced in enumerate(is_speech):
            t = i * frame_dur
            if voiced and not in_segment:
                seg_start = t
                in_segment = True
            elif not voiced and in_segment:
                segments.append((seg_start, t))
                in_segment = False

        # Close a trailing segment.
        if in_segment:
            segments.append((seg_start, len(is_speech) * frame_dur))

        return segments

    @staticmethod
    def _merge_short_segments(
        segments: List[tuple], min_duration: float
    ) -> List[tuple]:
        """Merge segments shorter than *min_duration* with their predecessor."""
        if not segments:
            return segments

        merged: List[tuple] = [segments[0]]
        for start, end in segments[1:]:
            prev_start, prev_end = merged[-1]
            if (end - start) < min_duration:
                # Extend the previous segment.
                merged[-1] = (prev_start, end)
            else:
                merged.append((start, end))
        return merged
