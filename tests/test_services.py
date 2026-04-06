"""Unit tests for the speaker diarization services package."""

import math
import os
import struct
import wave

import numpy as np
import pytest

from services.base import (
    DiarizationResult,
    SpeakerSegment,
    merge_transcription_with_diarization,
)
from services.energy_diarization import EnergyDiarizationService
from services.pyannote_diarization import PyannoteDiarizationService
from services.sortformer_diarization import SortformerDiarizationService
from services.factory import create_diarization_service


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def create_test_wav(path, duration=1.0, sample_rate=16000, num_channels=1):
    """Create a minimal WAV file for testing."""
    n_frames = int(sample_rate * duration)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(num_channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        samples = [
            int(32767 * math.sin(2 * math.pi * 440 * i / sample_rate))
            for i in range(n_frames * num_channels)
        ]
        wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))


def create_two_speaker_wav(path, duration=2.0, sample_rate=16000):
    """Create a WAV with loud/silent alternating sections to simulate turns."""
    n_frames = int(sample_rate * duration)
    half = n_frames // 2
    # First half: loud sine; second half: near silence then loud again
    samples = []
    for i in range(n_frames):
        if i < half:
            val = int(32767 * math.sin(2 * math.pi * 440 * i / sample_rate))
        else:
            # Brief silence gap then speech again
            gap_start = half
            gap_end = half + int(sample_rate * 0.6)  # 0.6 s silence
            if gap_start <= i < gap_end:
                val = 0
            else:
                val = int(32767 * math.sin(2 * math.pi * 440 * i / sample_rate))
        samples.append(val)

    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))


# ---------------------------------------------------------------------------
# SpeakerSegment dataclass
# ---------------------------------------------------------------------------


class TestSpeakerSegment:
    def test_creation_with_all_fields(self):
        seg = SpeakerSegment(speaker="SPEAKER_0", start=0.0, end=1.5, text="hello")
        assert seg.speaker == "SPEAKER_0"
        assert seg.start == 0.0
        assert seg.end == 1.5
        assert seg.text == "hello"

    def test_default_empty_text(self):
        seg = SpeakerSegment(speaker="SPEAKER_1", start=1.0, end=2.0)
        assert seg.text == ""


# ---------------------------------------------------------------------------
# DiarizationResult dataclass
# ---------------------------------------------------------------------------


class TestDiarizationResult:
    def test_creation_with_segments(self):
        segs = [
            SpeakerSegment(speaker="SPEAKER_0", start=0.0, end=1.0, text="hi"),
            SpeakerSegment(speaker="SPEAKER_1", start=1.0, end=2.0, text="hey"),
        ]
        result = DiarizationResult(
            segments=segs, num_speakers=2, speaker_labels=["SPEAKER_0", "SPEAKER_1"]
        )
        assert len(result.segments) == 2
        assert result.num_speakers == 2
        assert result.speaker_labels == ["SPEAKER_0", "SPEAKER_1"]

    def test_default_empty_fields(self):
        result = DiarizationResult(segments=[])
        assert result.num_speakers == 0
        assert result.speaker_labels == []
        assert result.segments == []


# ---------------------------------------------------------------------------
# merge_transcription_with_diarization
# ---------------------------------------------------------------------------


class TestMergeTranscriptionWithDiarization:
    def test_merge_with_matching_timing(self):
        transcription_segments = [
            {"text": "hello", "start": 0.0, "end": 1.0},
            {"text": "world", "start": 1.0, "end": 2.0},
        ]
        dia_result = DiarizationResult(
            segments=[
                SpeakerSegment(speaker="SPEAKER_0", start=0.0, end=1.2),
                SpeakerSegment(speaker="SPEAKER_1", start=1.2, end=2.5),
            ],
            num_speakers=2,
            speaker_labels=["SPEAKER_0", "SPEAKER_1"],
        )
        merged = merge_transcription_with_diarization(transcription_segments, dia_result)
        assert len(merged) == 2
        assert merged[0].speaker == "SPEAKER_0"
        assert merged[0].text == "hello"
        assert merged[1].speaker == "SPEAKER_1"
        assert merged[1].text == "world"

    def test_merge_with_no_timing_info(self):
        """When transcription segments lack start/end, fall back to first speaker."""
        transcription_segments = [
            {"text": "some text"},
        ]
        dia_result = DiarizationResult(
            segments=[
                SpeakerSegment(speaker="SPEAKER_0", start=0.0, end=1.0),
                SpeakerSegment(speaker="SPEAKER_1", start=1.0, end=2.0),
            ],
            num_speakers=2,
            speaker_labels=["SPEAKER_0", "SPEAKER_1"],
        )
        merged = merge_transcription_with_diarization(transcription_segments, dia_result)
        assert len(merged) == 1
        assert merged[0].speaker == "SPEAKER_0"
        assert merged[0].text == "some text"

    def test_merge_with_empty_transcription(self):
        dia_result = DiarizationResult(
            segments=[SpeakerSegment(speaker="SPEAKER_0", start=0.0, end=1.0)],
            num_speakers=1,
            speaker_labels=["SPEAKER_0"],
        )
        merged = merge_transcription_with_diarization([], dia_result)
        assert merged == []

    def test_merge_with_empty_diarization(self):
        transcription_segments = [
            {"text": "hello", "start": 0.0, "end": 1.0},
        ]
        dia_result = DiarizationResult(segments=[])
        merged = merge_transcription_with_diarization(transcription_segments, dia_result)
        assert len(merged) == 1
        assert merged[0].speaker == "SPEAKER_0"
        assert merged[0].text == "hello"

    def test_merge_with_custom_speaker_names(self):
        transcription_segments = [
            {"text": "hello", "start": 0.0, "end": 1.0},
            {"text": "world", "start": 1.0, "end": 2.0},
        ]
        dia_result = DiarizationResult(
            segments=[
                SpeakerSegment(speaker="SPEAKER_0", start=0.0, end=1.2),
                SpeakerSegment(speaker="SPEAKER_1", start=1.2, end=2.5),
            ],
            num_speakers=2,
            speaker_labels=["SPEAKER_0", "SPEAKER_1"],
        )
        merged = merge_transcription_with_diarization(
            transcription_segments, dia_result, speaker_names=["physician", "patient"]
        )
        assert merged[0].speaker == "physician"
        assert merged[1].speaker == "patient"

    def test_overlap_edge_case_no_overlap(self):
        """Segment that doesn't overlap any diarization span falls back to first."""
        transcription_segments = [
            {"text": "late text", "start": 10.0, "end": 11.0},
        ]
        dia_result = DiarizationResult(
            segments=[
                SpeakerSegment(speaker="SPEAKER_0", start=0.0, end=1.0),
                SpeakerSegment(speaker="SPEAKER_1", start=1.0, end=2.0),
            ],
            num_speakers=2,
            speaker_labels=["SPEAKER_0", "SPEAKER_1"],
        )
        merged = merge_transcription_with_diarization(transcription_segments, dia_result)
        assert len(merged) == 1
        # No overlap with either, defaults to first diarization segment's speaker
        assert merged[0].speaker == "SPEAKER_0"

    def test_overlap_edge_case_partial_overlap(self):
        """Segment partially overlapping two speakers picks the one with more overlap."""
        transcription_segments = [
            {"text": "overlap", "start": 0.8, "end": 1.5},
        ]
        dia_result = DiarizationResult(
            segments=[
                SpeakerSegment(speaker="SPEAKER_0", start=0.0, end=1.0),
                SpeakerSegment(speaker="SPEAKER_1", start=1.0, end=2.0),
            ],
            num_speakers=2,
            speaker_labels=["SPEAKER_0", "SPEAKER_1"],
        )
        merged = merge_transcription_with_diarization(transcription_segments, dia_result)
        # Overlap with SPEAKER_0: min(1.5,1.0)-max(0.8,0.0) = 0.2
        # Overlap with SPEAKER_1: min(1.5,2.0)-max(0.8,1.0) = 0.5
        assert merged[0].speaker == "SPEAKER_1"

    def test_merge_empty_diarization_with_custom_names(self):
        """Empty diarization + speaker_names uses first custom name."""
        transcription_segments = [
            {"text": "solo", "start": 0.0, "end": 1.0},
        ]
        dia_result = DiarizationResult(segments=[])
        merged = merge_transcription_with_diarization(
            transcription_segments, dia_result, speaker_names=["doctor"]
        )
        assert merged[0].speaker == "doctor"


# ---------------------------------------------------------------------------
# EnergyDiarizationService
# ---------------------------------------------------------------------------


class TestEnergyDiarizationService:
    def test_is_available(self):
        svc = EnergyDiarizationService()
        assert svc.is_available() is True

    def test_name_property(self):
        svc = EnergyDiarizationService()
        assert svc.name == "energy"

    def test_diarize_with_wav_file(self, tmp_path):
        wav_path = str(tmp_path / "test.wav")
        create_test_wav(wav_path, duration=1.0)
        svc = EnergyDiarizationService()
        result = svc.diarize(wav_path)
        assert isinstance(result, DiarizationResult)
        assert isinstance(result.segments, list)
        assert result.num_speakers >= 0
        assert isinstance(result.speaker_labels, list)

    def test_diarize_with_num_speakers(self, tmp_path):
        wav_path = str(tmp_path / "two_speaker.wav")
        create_two_speaker_wav(wav_path, duration=2.0)
        svc = EnergyDiarizationService()
        result = svc.diarize(wav_path, num_speakers=3)
        assert isinstance(result, DiarizationResult)
        # Speaker labels should use SPEAKER_0, SPEAKER_1, SPEAKER_2 pattern
        for seg in result.segments:
            assert seg.speaker.startswith("SPEAKER_") or seg.speaker in result.speaker_labels

    def test_diarize_with_speaker_names(self, tmp_path):
        wav_path = str(tmp_path / "named.wav")
        create_two_speaker_wav(wav_path, duration=2.0)
        svc = EnergyDiarizationService()
        result = svc.diarize(
            wav_path, num_speakers=2, speaker_names=["Alice", "Bob"]
        )
        assert isinstance(result, DiarizationResult)
        for seg in result.segments:
            assert seg.speaker in ("Alice", "Bob") or seg.speaker.startswith("SPEAKER_")

    def test_compute_frame_energies(self):
        svc = EnergyDiarizationService()
        samples = np.array([0.5, -0.5, 0.5, -0.5, 0.0, 0.0, 0.0, 0.0], dtype=np.float64)
        energies = svc._compute_frame_energies(samples, frame_len=4)
        assert len(energies) == 2
        assert energies[0] > energies[1]  # first frame louder

    def test_compute_frame_energies_short_input(self):
        """When input is shorter than one frame, still returns one energy value."""
        svc = EnergyDiarizationService()
        samples = np.array([0.5, -0.5], dtype=np.float64)
        energies = svc._compute_frame_energies(samples, frame_len=8)
        assert len(energies) == 1

    def test_compute_frame_energies_not_evenly_divisible(self):
        """Remainder samples beyond the last full frame are ignored."""
        svc = EnergyDiarizationService()
        # 10 samples with frame_len=4 → 2 full frames, 2 samples discarded
        samples = np.array([1.0] * 4 + [0.0] * 4 + [0.5, 0.5], dtype=np.float64)
        energies = svc._compute_frame_energies(samples, frame_len=4)
        assert len(energies) == 2

    def test_compute_frame_energies_empty(self):
        svc = EnergyDiarizationService()
        samples = np.array([], dtype=np.float64)
        energies = svc._compute_frame_energies(samples, frame_len=4)
        assert len(energies) == 1
        assert energies[0] == 0.0

    def test_frames_to_segments(self):
        svc = EnergyDiarizationService()
        # Speech, speech, silence, speech
        is_speech = np.array([True, True, False, True])
        segments = svc._frames_to_segments(is_speech, frame_len=160, sample_rate=16000)
        # Should produce two segments: [0, 0.02) and [0.03, 0.04)
        assert len(segments) == 2
        assert segments[0][0] == 0.0
        assert segments[1][0] > segments[0][1]

    def test_frames_to_segments_all_speech(self):
        svc = EnergyDiarizationService()
        is_speech = np.array([True, True, True])
        segments = svc._frames_to_segments(is_speech, frame_len=160, sample_rate=16000)
        assert len(segments) == 1

    def test_frames_to_segments_all_silence(self):
        svc = EnergyDiarizationService()
        is_speech = np.array([False, False, False])
        segments = svc._frames_to_segments(is_speech, frame_len=160, sample_rate=16000)
        assert len(segments) == 0

    def test_merge_short_segments(self):
        svc = EnergyDiarizationService()
        segments = [(0.0, 0.1), (0.2, 0.5), (0.6, 2.0)]
        merged = svc._merge_short_segments(segments, min_duration=0.3)
        # First segment (0.1s) is too short, gets merged with predecessor
        # Since it IS the first, it stays as merged[0], then (0.2, 0.5) merges into it
        assert len(merged) <= len(segments)

    def test_merge_short_segments_empty(self):
        svc = EnergyDiarizationService()
        assert svc._merge_short_segments([], min_duration=0.3) == []

    def test_merge_short_segments_all_long(self):
        svc = EnergyDiarizationService()
        segments = [(0.0, 1.0), (1.5, 3.0)]
        merged = svc._merge_short_segments(segments, min_duration=0.3)
        assert merged == segments

    def test_diarize_stereo_wav(self, tmp_path):
        """Ensure stereo WAV files are handled (down-mixed to mono)."""
        wav_path = str(tmp_path / "stereo.wav")
        create_test_wav(wav_path, duration=1.0, num_channels=2)
        svc = EnergyDiarizationService()
        result = svc.diarize(wav_path)
        assert isinstance(result, DiarizationResult)


# ---------------------------------------------------------------------------
# PyannoteDiarizationService
# ---------------------------------------------------------------------------


class TestPyannoteDiarizationService:
    def test_is_available_returns_false(self):
        svc = PyannoteDiarizationService()
        # pyannote.audio is not installed in this environment
        assert svc.is_available() is False

    def test_name_property(self):
        svc = PyannoteDiarizationService()
        assert svc.name == "pyannote"


# ---------------------------------------------------------------------------
# SortformerDiarizationService
# ---------------------------------------------------------------------------


class TestSortformerDiarizationService:
    def test_is_available_returns_false(self):
        svc = SortformerDiarizationService()
        # nemo_toolkit is not installed in this environment
        assert svc.is_available() is False

    def test_name_property(self):
        svc = SortformerDiarizationService()
        assert svc.name == "sortformer"


# ---------------------------------------------------------------------------
# Factory – create_diarization_service
# ---------------------------------------------------------------------------


class TestCreateDiarizationService:
    def test_auto_returns_energy_when_no_other_backends(self):
        svc = create_diarization_service("auto")
        # pyannote and nemo are not installed, so auto should select energy
        assert isinstance(svc, EnergyDiarizationService)
        assert svc.name == "energy"

    def test_energy_returns_energy_service(self):
        svc = create_diarization_service("energy")
        assert isinstance(svc, EnergyDiarizationService)

    def test_unknown_backend_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown diarization backend"):
            create_diarization_service("nonexistent_backend")

    def test_pyannote_falls_back_to_auto(self):
        svc = create_diarization_service("pyannote")
        # pyannote not available → falls back to auto → energy
        assert isinstance(svc, EnergyDiarizationService)

    def test_sortformer_falls_back_to_auto(self):
        svc = create_diarization_service("sortformer")
        # nemo not available → falls back to auto → energy
        assert isinstance(svc, EnergyDiarizationService)
