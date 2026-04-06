"""Unit tests for parakeet_with_diarization_server.py"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, Mock
import tempfile
import os
import io
import asyncio
import math
import struct
import wave
import json

# Mock the parakeet_mlx import before importing the server
import sys
sys.modules['parakeet_mlx'] = MagicMock()
sys.modules['huggingface_hub'] = MagicMock()

from parakeet_with_diarization_server import (
    app,
    clean_text,
    extract_text,
    extract_segments,
    sanitize_filename,
    validate_file_type,
    TranscriptionResponse,
    DiarizedTranscriptionResponse,
    load_model,
    check_python_version,
    validate_system_requirements,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def create_test_wav_bytes(duration=1.0, sample_rate=16000, num_channels=1):
    """Create a minimal WAV file in memory and return its bytes."""
    n_frames = int(sample_rate * duration)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(num_channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        samples = [
            int(32767 * math.sin(2 * math.pi * 440 * i / sample_rate))
            for i in range(n_frames * num_channels)
        ]
        wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    """Create a test client."""
    return TestClient(app)


@pytest.fixture
def mock_model():
    """Create a mock model for testing."""
    mock = MagicMock()
    mock.transcribe.return_value = MagicMock(
        text="Test transcription",
        segments=[
            MagicMock(text="Test", start=0.0, end=1.0),
            MagicMock(text="transcription", start=1.0, end=2.0),
        ],
    )
    return mock


@pytest.fixture
def mock_diarization_service():
    """Create a mock diarization service."""
    from services.base import DiarizationResult, SpeakerSegment

    mock_svc = MagicMock()
    mock_svc.name = "mock_energy"
    mock_svc.is_available.return_value = True
    mock_svc.diarize.return_value = DiarizationResult(
        segments=[
            SpeakerSegment(speaker="SPEAKER_0", start=0.0, end=1.0),
            SpeakerSegment(speaker="SPEAKER_1", start=1.0, end=2.0),
        ],
        num_speakers=2,
        speaker_labels=["SPEAKER_0", "SPEAKER_1"],
    )
    return mock_svc


# ---------------------------------------------------------------------------
# DiarizedTranscriptionResponse model
# ---------------------------------------------------------------------------


class TestDiarizedTranscriptionResponse:
    def test_full_construction(self):
        resp = DiarizedTranscriptionResponse(
            text="Hello world",
            recording_timestamp="2024-01-01T00:00:00",
            segments=[{"text": "Hello", "start": 0.0, "end": 0.5}],
            speakers=[
                {"speaker": "SPEAKER_0", "start": 0.0, "end": 0.5, "text": "Hello"}
            ],
            num_speakers=2,
            speaker_labels=["SPEAKER_0", "SPEAKER_1"],
        )
        assert resp.text == "Hello world"
        assert resp.recording_timestamp == "2024-01-01T00:00:00"
        assert resp.segments is not None
        assert resp.speakers is not None
        assert resp.num_speakers == 2
        assert resp.speaker_labels == ["SPEAKER_0", "SPEAKER_1"]

    def test_minimal_construction(self):
        resp = DiarizedTranscriptionResponse(text="Hi")
        assert resp.text == "Hi"
        assert resp.recording_timestamp is None
        assert resp.segments is None
        assert resp.speakers is None
        assert resp.num_speakers is None
        assert resp.speaker_labels is None

    def test_json_serialization(self):
        resp = DiarizedTranscriptionResponse(
            text="test",
            num_speakers=1,
            speaker_labels=["SPEAKER_0"],
            speakers=[
                {"speaker": "SPEAKER_0", "start": 0.0, "end": 1.0, "text": "test"}
            ],
        )
        data = resp.model_dump()
        assert data["text"] == "test"
        assert data["num_speakers"] == 1
        assert isinstance(data["speaker_labels"], list)
        assert isinstance(data["speakers"], list)

        # Also confirm json() round-trip
        json_str = resp.model_dump_json()
        assert '"text":"test"' in json_str or '"text": "test"' in json_str


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


class TestHealthEndpoint:
    def test_health_returns_diarization_info(self, client):
        response = client.get("/health")
        assert response.status_code in (200, 503)
        data = response.json()
        assert "diarization_backend" in data
        assert "diarization_available" in data

    def test_health_returns_streaming_info(self, client):
        response = client.get("/health")
        data = response.json()
        assert "streaming_mode" in data


# ---------------------------------------------------------------------------
# Diarize endpoint
# ---------------------------------------------------------------------------


class TestDiarizeEndpoint:
    def test_returns_503_when_model_not_loaded(self, client):
        import parakeet_with_diarization_server as srv

        original = srv.model
        srv.model = None
        try:
            wav_data = create_test_wav_bytes()
            response = client.post(
                "/v1/audio/transcriptions/diarize",
                files={"file": ("test.wav", wav_data, "audio/wav")},
            )
            assert response.status_code == 503
            assert "Model not loaded" in response.json()["detail"]
        finally:
            srv.model = original

    def test_returns_503_when_diarization_not_loaded(self, client, mock_model):
        import parakeet_with_diarization_server as srv

        original_model = srv.model
        original_dia = srv.diarization_service
        srv.model = mock_model
        srv.diarization_service = None
        try:
            wav_data = create_test_wav_bytes()
            response = client.post(
                "/v1/audio/transcriptions/diarize",
                files={"file": ("test.wav", wav_data, "audio/wav")},
            )
            assert response.status_code == 503
            assert "Diarization service not available" in response.json()["detail"]
        finally:
            srv.model = original_model
            srv.diarization_service = original_dia

    def test_returns_400_for_invalid_file_type(self, client, mock_model, mock_diarization_service):
        import parakeet_with_diarization_server as srv

        original_model = srv.model
        original_dia = srv.diarization_service
        srv.model = mock_model
        srv.diarization_service = mock_diarization_service
        try:
            response = client.post(
                "/v1/audio/transcriptions/diarize",
                files={"file": ("test.txt", b"not audio", "text/plain")},
            )
            assert response.status_code == 400
            assert "Invalid file type" in response.json()["detail"]
        finally:
            srv.model = original_model
            srv.diarization_service = original_dia

    def test_returns_400_for_empty_file(self, client, mock_model, mock_diarization_service):
        import parakeet_with_diarization_server as srv

        original_model = srv.model
        original_dia = srv.diarization_service
        srv.model = mock_model
        srv.diarization_service = mock_diarization_service
        try:
            response = client.post(
                "/v1/audio/transcriptions/diarize",
                files={"file": ("test.wav", b"", "audio/wav")},
            )
            assert response.status_code == 400
            assert "Empty file" in response.json()["detail"]
        finally:
            srv.model = original_model
            srv.diarization_service = original_dia

    def test_returns_400_for_missing_filename(self, client, mock_model, mock_diarization_service):
        import parakeet_with_diarization_server as srv

        original_model = srv.model
        original_dia = srv.diarization_service
        srv.model = mock_model
        srv.diarization_service = mock_diarization_service
        try:
            response = client.post(
                "/v1/audio/transcriptions/diarize",
                files={"file": ("", b"some bytes", "audio/wav")},
            )
            # FastAPI may return 400 (explicit check) or 422 (validation)
            assert response.status_code in (400, 422)
        finally:
            srv.model = original_model
            srv.diarization_service = original_dia

    def test_successful_diarization(self, client, mock_model, mock_diarization_service):
        import parakeet_with_diarization_server as srv

        original_model = srv.model
        original_dia = srv.diarization_service
        srv.model = mock_model
        srv.diarization_service = mock_diarization_service
        try:
            wav_data = create_test_wav_bytes()
            response = client.post(
                "/v1/audio/transcriptions/diarize",
                files={"file": ("test.wav", wav_data, "audio/wav")},
            )
            assert response.status_code == 200
            data = response.json()
            assert "text" in data
            assert "speakers" in data
            assert "num_speakers" in data
            assert "speaker_labels" in data
        finally:
            srv.model = original_model
            srv.diarization_service = original_dia


# ---------------------------------------------------------------------------
# Stream endpoint
# ---------------------------------------------------------------------------


class TestStreamEndpoint:
    def test_returns_503_when_model_not_loaded(self, client):
        import parakeet_with_diarization_server as srv

        original = srv.model
        srv.model = None
        try:
            wav_data = create_test_wav_bytes()
            response = client.post(
                "/v1/audio/transcriptions/stream",
                files={"file": ("test.wav", wav_data, "audio/wav")},
            )
            assert response.status_code == 503
            assert "Model not loaded" in response.json()["detail"]
        finally:
            srv.model = original

    def test_returns_400_for_invalid_file(self, client, mock_model):
        import parakeet_with_diarization_server as srv

        original = srv.model
        srv.model = mock_model
        try:
            response = client.post(
                "/v1/audio/transcriptions/stream",
                files={"file": ("test.txt", b"not audio", "text/plain")},
            )
            assert response.status_code == 400
        finally:
            srv.model = original


# ---------------------------------------------------------------------------
# Original transcription endpoint
# ---------------------------------------------------------------------------


class TestOriginalTranscriptionEndpoint:
    def test_returns_503_when_model_not_loaded(self, client):
        import parakeet_with_diarization_server as srv

        original = srv.model
        srv.model = None
        try:
            wav_data = create_test_wav_bytes()
            response = client.post(
                "/v1/audio/transcriptions",
                files={"file": ("test.wav", wav_data, "audio/wav")},
            )
            assert response.status_code == 503
            assert "Model not loaded" in response.json()["detail"]
        finally:
            srv.model = original


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


class TestWebSocketEndpoint:
    def test_basic_connection(self, client):
        with client.websocket_connect("/v1/audio/transcriptions/ws") as ws:
            # Send a config message
            ws.send_json({"diarize": False})
            # Close cleanly by sending close control
            ws.send_json({"type": "close"})


# ---------------------------------------------------------------------------
# Utility function tests (mirrors test_server.py)
# ---------------------------------------------------------------------------


class TestCleanText:
    def test_clean_text_basic(self):
        assert clean_text("hello  world") == "hello world"
        assert clean_text("  test  ") == "test"
        assert clean_text("hello <unk> world") == "hello world"
        assert clean_text("") == ""


class TestExtractText:
    def test_extract_text_from_object(self):
        obj = MagicMock(text="test text", segments=None)
        assert extract_text(obj) == "test text"

    def test_extract_text_from_dict(self):
        d = {"text": "hello", "segments": []}
        # Empty segments list → extract_text returns text field
        assert extract_text(d) == "hello"


class TestExtractSegments:
    def test_extract_segments_from_object(self):
        obj = MagicMock(
            segments=[
                MagicMock(text="seg1", start=0.0, end=1.0),
                MagicMock(text="seg2", start=1.0, end=2.0),
            ]
        )
        result = extract_segments(obj)
        assert result is not None
        assert len(result) == 2
        assert result[0]["text"] == "seg1"
        assert result[0]["start"] == 0.0

    def test_extract_segments_returns_none_for_empty(self):
        obj = MagicMock(segments=[])
        # segments is a truthy MagicMock by default; set it to empty list
        obj.segments = []
        result = extract_segments(obj)
        assert result is None


class TestSanitizeFilename:
    def test_basic_sanitize(self):
        assert sanitize_filename("test.wav") == "test.wav"

    def test_path_traversal(self):
        result = sanitize_filename("../../etc/passwd")
        assert "/" not in result
        assert "\\" not in result


class TestValidateFileType:
    def test_valid_wav(self):
        assert validate_file_type("test.wav", "audio/wav") is True

    def test_invalid_extension(self):
        assert validate_file_type("test.txt", "text/plain") is False
