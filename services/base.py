"""Base classes and data models for speaker diarization services.

This module defines the abstract interface that all diarization backends must
implement, along with shared data models and a utility function for merging
transcription output with diarization results.
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)


@dataclass
class SpeakerSegment:
    """A segment of audio attributed to a specific speaker.

    Attributes:
        speaker: Speaker label (e.g., ``"SPEAKER_0"`` or a custom name like
            ``"physician"``).
        start: Start time in seconds.
        end: End time in seconds.
        text: Transcribed text for this segment.  Populated after merging
            diarization output with a transcription.
    """

    speaker: str
    start: float
    end: float
    text: str = ""


@dataclass
class DiarizationResult:
    """Result from speaker diarization.

    Attributes:
        segments: Ordered list of speaker segments.
        num_speakers: Number of distinct speakers detected.
        speaker_labels: List of unique speaker labels present in the result.
    """

    segments: List[SpeakerSegment]
    num_speakers: int = 0
    speaker_labels: List[str] = field(default_factory=list)


class DiarizationService(ABC):
    """Abstract base class for speaker diarization services.

    Every concrete backend (PyAnnote, NeMo/Sortformer, energy-based, …) must
    subclass this and implement the three abstract members.
    """

    @abstractmethod
    def diarize(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        speaker_names: Optional[List[str]] = None,
    ) -> DiarizationResult:
        """Perform speaker diarization on an audio file.

        Args:
            audio_path: Path to the audio file to diarize.
            num_speakers: Optional hint for the expected number of speakers.
            speaker_names: Optional list of human-readable names to assign to
                detected speakers (e.g., ``["physician", "patient"]``).
                ``SPEAKER_0`` is mapped to the first name, ``SPEAKER_1`` to
                the second, and so on.

        Returns:
            A :class:`DiarizationResult` with speaker-attributed segments.
        """

    @abstractmethod
    def is_available(self) -> bool:
        """Check whether this diarization backend is usable.

        Returns:
            ``True`` if all required dependencies are installed and the
            service can be used, ``False`` otherwise.
        """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the human-readable name of this diarization backend."""


# ---------------------------------------------------------------------------
# Utility: merge transcription with diarization
# ---------------------------------------------------------------------------


def _overlap(seg_start: float, seg_end: float, dia_start: float, dia_end: float) -> float:
    """Return the duration of overlap between two time intervals."""
    return max(0.0, min(seg_end, dia_end) - max(seg_start, dia_start))


def merge_transcription_with_diarization(
    transcription_segments: List[dict],
    diarization_result: DiarizationResult,
    speaker_names: Optional[List[str]] = None,
) -> List[SpeakerSegment]:
    """Merge transcription segments with diarization output.

    Each transcription segment is assigned to the diarization speaker whose
    time span has the largest overlap with it.

    Args:
        transcription_segments: List of segment dicts as produced by
            ``extract_segments`` in *parakeet_server*.  Each dict **must**
            contain a ``"text"`` key and **may** contain ``"start"`` and
            ``"end"`` keys (floats, in seconds).
        diarization_result: The :class:`DiarizationResult` to merge with.
        speaker_names: Optional list of display names.  When provided,
            generic labels are replaced: ``SPEAKER_0`` → first name,
            ``SPEAKER_1`` → second name, etc.

    Returns:
        A list of :class:`SpeakerSegment` objects with ``text`` populated
        from the transcription and ``speaker`` from the diarization.
    """
    if not transcription_segments:
        logger.debug("No transcription segments to merge.")
        return []

    if not diarization_result.segments:
        logger.debug("No diarization segments; returning transcription as single-speaker.")
        return [
            SpeakerSegment(
                speaker=speaker_names[0] if speaker_names else "SPEAKER_0",
                start=seg.get("start", 0.0),
                end=seg.get("end", 0.0),
                text=seg.get("text", ""),
            )
            for seg in transcription_segments
        ]

    # Build a speaker-name mapping from generic labels to custom names.
    label_map: dict[str, str] = {}
    if speaker_names:
        for idx, custom_name in enumerate(speaker_names):
            label_map[f"SPEAKER_{idx}"] = custom_name

    dia_segments = diarization_result.segments
    merged: List[SpeakerSegment] = []

    for seg in transcription_segments:
        text = seg.get("text", "")
        seg_start = seg.get("start")
        seg_end = seg.get("end")

        # If the transcription segment has no timing info we cannot match it
        # against the diarization timeline; fall back to the default speaker.
        if seg_start is None or seg_end is None:
            fallback_label = dia_segments[0].speaker if dia_segments else "SPEAKER_0"
            speaker = label_map.get(fallback_label, fallback_label)
            merged.append(
                SpeakerSegment(
                    speaker=speaker,
                    start=seg_start if seg_start is not None else 0.0,
                    end=seg_end if seg_end is not None else 0.0,
                    text=text,
                )
            )
            continue

        # Find the diarization segment with the greatest time overlap.
        best_speaker = dia_segments[0].speaker
        best_overlap = 0.0
        for d_seg in dia_segments:
            ov = _overlap(seg_start, seg_end, d_seg.start, d_seg.end)
            if ov > best_overlap:
                best_overlap = ov
                best_speaker = d_seg.speaker

        speaker = label_map.get(best_speaker, best_speaker)
        merged.append(
            SpeakerSegment(speaker=speaker, start=seg_start, end=seg_end, text=text)
        )

    logger.debug("Merged %d transcription segments with diarization.", len(merged))
    return merged
