# Speaker Diarization Implementation Plan

## Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Service Interface](#2-service-interface)
- [3. Backend Implementations](#3-backend-implementations)
  - [3.1 PyAnnote-Based Diarization](#31-pyannote-based-diarization)
  - [3.2 Sortformer-Based Diarization (NeMo)](#32-sortformer-based-diarization-nemo)
  - [3.3 Simple Energy-Based Diarization](#33-simple-energy-based-diarization)
- [4. Configuration](#4-configuration)
- [5. Server Changes](#5-server-changes)
- [6. Streaming Support](#6-streaming-support)
  - [6.1 HTTP Chunk-Based Streaming (Neartime)](#61-http-chunk-based-streaming-neartime)
  - [6.2 WebSocket-Based Streaming (Realtime)](#62-websocket-based-streaming-realtime)
  - [6.3 Streaming Mode Selection](#63-streaming-mode-selection)
- [7. API Endpoints](#7-api-endpoints)
- [8. File Structure](#8-file-structure)
- [9. Migration & Rollout Strategy](#9-migration--rollout-strategy)

---

## 1. Architecture Overview

Speaker diarization ("who spoke when") is added as a **service-based plugin architecture**
alongside the existing transcription pipeline. The design follows these principles:

- **Separation of concerns** — diarization is decoupled from transcription via a service interface.
- **Exchangeable backends** — multiple diarization engines can be swapped at configuration time
  without code changes.
- **Non-breaking** — the original `parakeet_server.py` remains untouched; a new server file
  `parakeet_with_diarization_server.py` extends it.
- **Consistent API contract** — all backends return the same `DiarizationResult` data model.

```
┌─────────────────────────────────────────────────────────────────┐
│                        FastAPI Application                      │
│              parakeet_with_diarization_server.py                 │
│                                                                 │
│  ┌──────────────────┐   ┌───────────────────────────────────┐   │
│  │  Transcription    │   │  Diarization Service (plugin)     │   │
│  │  (parakeet_mlx)   │   │                                   │   │
│  │                   │   │  ┌─────────┐ ┌──────────┐        │   │
│  │  /v1/audio/       │   │  │ PyAnnote│ │Sortformer│        │   │
│  │  transcriptions   │   │  │ Backend │ │ Backend  │  ...   │   │
│  │                   │   │  └────┬────┘ └────┬─────┘        │   │
│  └────────┬─────────┘   │       │            │              │   │
│           │              │  ┌────▼────────────▼─────┐       │   │
│           │              │  │  DiarizationService    │       │   │
│           │              │  │  (Abstract Interface)  │       │   │
│           │              │  └───────────────────────-┘       │   │
│           │              └───────────────┬───────────────────┘   │
│           │                              │                       │
│           └──────────┬───────────────────┘                       │
│                      ▼                                           │
│             Merge: transcription segments + speaker labels       │
│                      │                                           │
│                      ▼                                           │
│              DiarizedTranscriptionResponse                       │
└─────────────────────────────────────────────────────────────────┘
```

**Data flow:**

1. Client uploads an audio file to a diarized transcription endpoint.
2. The server runs transcription (parakeet_mlx) and diarization (selected backend) concurrently.
3. A merge step aligns transcription segments with speaker labels using timestamp overlap.
4. The merged result is returned as a `DiarizedTranscriptionResponse`.

---

## 2. Service Interface

All diarization backends implement a common abstract base class. This ensures every backend
is a drop-in replacement with identical inputs and outputs.

### Abstract Base Class

```python
# diarization/service.py

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class SpeakerSegment:
    """A single contiguous region attributed to one speaker."""
    speaker: str          # Speaker label, e.g. "SPEAKER_00" or a custom name
    start: float          # Start time in seconds
    end: float            # End time in seconds
    confidence: float = 0.0  # Backend-specific confidence score (0.0–1.0)


@dataclass
class DiarizationResult:
    """Complete diarization output for an audio file."""
    segments: List[SpeakerSegment]
    num_speakers: int
    speaker_labels: List[str]           # Ordered list of unique labels
    backend: str                        # Backend identifier, e.g. "pyannote"
    processing_time_seconds: float = 0.0
    metadata: dict = field(default_factory=dict)


class DiarizationService(ABC):
    """Abstract interface that every diarization backend must implement."""

    @abstractmethod
    async def diarize(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        speaker_names: Optional[List[str]] = None,
    ) -> DiarizationResult:
        """
        Run speaker diarization on an audio file.

        Args:
            audio_path:    Path to the audio file on disk.
            num_speakers:  Hint for the expected number of speakers.
                           If None, the backend auto-detects.
            speaker_names: Optional human-readable names to map onto
                           detected speaker labels (in order of first
                           appearance). Length must equal num_speakers
                           when both are supplied.

        Returns:
            DiarizationResult with speaker-attributed time segments.
        """
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """Check whether the backend's dependencies are installed and usable."""
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        """Short identifier for this backend, e.g. 'pyannote', 'sortformer'."""
        ...
```

### Merge Utility

A shared utility function aligns transcription segments with speaker labels:

```python
# diarization/merge.py

from typing import List, Optional


def merge_transcription_and_diarization(
    transcription_segments: List[dict],
    diarization_segments: List["SpeakerSegment"],
    speaker_names: Optional[List[str]] = None,
) -> List[dict]:
    """
    Assign a speaker label to each transcription segment by finding the
    diarization segment with the greatest temporal overlap.

    Returns a new list of segment dicts, each augmented with a "speaker" key.
    """
    merged = []
    label_map = {}
    if speaker_names:
        # Build a mapping from auto-generated labels to custom names
        unique_labels = sorted({s.speaker for s in diarization_segments})
        for idx, label in enumerate(unique_labels):
            if idx < len(speaker_names):
                label_map[label] = speaker_names[idx]

    for seg in transcription_segments:
        seg_start = seg.get("start", 0.0)
        seg_end = seg.get("end", seg_start)
        best_speaker = "UNKNOWN"
        best_overlap = 0.0

        for d_seg in diarization_segments:
            overlap_start = max(seg_start, d_seg.start)
            overlap_end = min(seg_end, d_seg.end)
            overlap = max(0.0, overlap_end - overlap_start)
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = d_seg.speaker

        speaker = label_map.get(best_speaker, best_speaker)
        merged.append({**seg, "speaker": speaker})

    return merged
```

---

## 3. Backend Implementations

### 3.1 PyAnnote-Based Diarization

[pyannote.audio](https://github.com/pyannote/pyannote-audio) is the most widely-used
open-source diarization toolkit. It provides pre-trained neural pipelines that handle
voice activity detection, speaker embedding, and clustering in a single call.

**When to use:** Best overall accuracy; recommended default when a HuggingFace token
is available and the `pyannote.audio` dependency can be installed.

```python
# diarization/backends/pyannote_backend.py

import time
import asyncio
import logging
from typing import List, Optional

from diarization.service import (
    DiarizationService,
    DiarizationResult,
    SpeakerSegment,
)

logger = logging.getLogger(__name__)


class PyAnnoteDiarizationService(DiarizationService):
    """Speaker diarization using pyannote.audio pipelines."""

    def __init__(
        self,
        model_name: str = "pyannote/speaker-diarization-3.1",
        hf_token: Optional[str] = None,
        device: Optional[str] = None,
    ):
        self._model_name = model_name
        self._hf_token = hf_token
        self._device = device
        self._pipeline = None

    def _load_pipeline(self):
        if self._pipeline is not None:
            return
        from pyannote.audio import Pipeline

        logger.info("Loading pyannote pipeline: %s", self._model_name)
        self._pipeline = Pipeline.from_pretrained(
            self._model_name,
            use_auth_token=self._hf_token,
        )
        if self._device:
            import torch
            self._pipeline = self._pipeline.to(torch.device(self._device))
        logger.info("pyannote pipeline loaded successfully")

    async def diarize(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        speaker_names: Optional[List[str]] = None,
    ) -> DiarizationResult:
        self._load_pipeline()
        start_time = time.monotonic()

        kwargs = {}
        if num_speakers is not None:
            kwargs["num_speakers"] = num_speakers

        # Run the blocking pipeline call in a thread pool
        annotation = await asyncio.to_thread(
            self._pipeline, audio_path, **kwargs
        )

        segments: List[SpeakerSegment] = []
        speaker_set: set = set()
        for turn, _, speaker_label in annotation.itertracks(yield_label=True):
            mapped = speaker_label
            speaker_set.add(mapped)
            segments.append(
                SpeakerSegment(
                    speaker=mapped,
                    start=round(turn.start, 3),
                    end=round(turn.end, 3),
                )
            )

        # Apply custom speaker names if provided
        ordered_labels = sorted(speaker_set)
        if speaker_names:
            name_map = {
                label: speaker_names[i]
                for i, label in enumerate(ordered_labels)
                if i < len(speaker_names)
            }
            for seg in segments:
                seg.speaker = name_map.get(seg.speaker, seg.speaker)
            ordered_labels = [
                name_map.get(l, l) for l in ordered_labels
            ]

        elapsed = time.monotonic() - start_time
        return DiarizationResult(
            segments=segments,
            num_speakers=len(speaker_set),
            speaker_labels=ordered_labels,
            backend=self.name,
            processing_time_seconds=round(elapsed, 3),
            metadata={"model": self._model_name},
        )

    async def is_available(self) -> bool:
        try:
            import pyannote.audio  # noqa: F401
            return True
        except ImportError:
            return False

    @property
    def name(self) -> str:
        return "pyannote"
```

**Dependencies (optional, added to a separate requirements file):**

```
pyannote.audio>=3.1
torch>=2.0
```

---

### 3.2 Sortformer-Based Diarization (NeMo)

[NVIDIA NeMo Sortformer](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/speaker_diarization/intro.html)
is a frame-level, end-to-end neural diarization model. Unlike clustering-based
approaches, it directly predicts speaker activity per frame, which can be more robust
for overlapping speech.

**When to use:** Best for scenarios with significant speaker overlap; requires the
`nemo_toolkit` dependency and a compatible GPU or Apple Silicon MPS.

```python
# diarization/backends/sortformer_backend.py

import time
import asyncio
import logging
from typing import List, Optional

from diarization.service import (
    DiarizationService,
    DiarizationResult,
    SpeakerSegment,
)

logger = logging.getLogger(__name__)


class SortformerDiarizationService(DiarizationService):
    """Speaker diarization using NeMo Sortformer models."""

    def __init__(
        self,
        model_name: str = "nvidia/diar_sortformer_4spk-v1",
        device: Optional[str] = None,
    ):
        self._model_name = model_name
        self._device = device or "cpu"
        self._model = None

    def _load_model(self):
        if self._model is not None:
            return
        from nemo.collections.asr.models import SortformerEncDecDiarModel

        logger.info("Loading Sortformer model: %s", self._model_name)
        self._model = SortformerEncDecDiarModel.from_pretrained(
            model_name=self._model_name,
            map_location=self._device,
        )
        self._model.eval()
        logger.info("Sortformer model loaded successfully")

    async def diarize(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        speaker_names: Optional[List[str]] = None,
    ) -> DiarizationResult:
        self._load_model()
        start_time = time.monotonic()

        # NeMo diarize returns a list of segment annotations
        raw_output = await asyncio.to_thread(
            self._model.diarize,
            [audio_path],
            num_speakers=num_speakers,
            batch_size=1,
        )

        segments: List[SpeakerSegment] = []
        speaker_set: set = set()

        # Parse NeMo RTTM-style output
        for entry in raw_output:
            speaker_label = entry.get("speaker", f"SPEAKER_{entry.get('speaker_id', 0):02d}")
            speaker_set.add(speaker_label)
            segments.append(
                SpeakerSegment(
                    speaker=speaker_label,
                    start=round(entry["start"], 3),
                    end=round(entry["end"], 3),
                    confidence=entry.get("confidence", 0.0),
                )
            )

        ordered_labels = sorted(speaker_set)
        if speaker_names:
            name_map = {
                label: speaker_names[i]
                for i, label in enumerate(ordered_labels)
                if i < len(speaker_names)
            }
            for seg in segments:
                seg.speaker = name_map.get(seg.speaker, seg.speaker)
            ordered_labels = [name_map.get(l, l) for l in ordered_labels]

        elapsed = time.monotonic() - start_time
        return DiarizationResult(
            segments=segments,
            num_speakers=len(speaker_set),
            speaker_labels=ordered_labels,
            backend=self.name,
            processing_time_seconds=round(elapsed, 3),
            metadata={"model": self._model_name},
        )

    async def is_available(self) -> bool:
        try:
            from nemo.collections.asr.models import SortformerEncDecDiarModel  # noqa: F401
            return True
        except ImportError:
            return False

    @property
    def name(self) -> str:
        return "sortformer"
```

**Dependencies (optional):**

```
nemo_toolkit[asr]>=2.0
torch>=2.0
```

---

### 3.3 Simple Energy-Based Diarization

A lightweight, **zero-dependency** fallback that segments audio by energy (volume)
levels. It does not perform true speaker identification — it simply detects speech
regions and assigns alternating speaker labels based on silence gaps.

**When to use:** Environments where neither PyAnnote nor NeMo can be installed (e.g.,
CI pipelines, edge deployments, or quick prototyping). Accuracy is significantly lower
than neural approaches.

```python
# diarization/backends/energy_backend.py

import time
import wave
import struct
import asyncio
import logging
import math
from typing import List, Optional

from diarization.service import (
    DiarizationService,
    DiarizationResult,
    SpeakerSegment,
)

logger = logging.getLogger(__name__)

# Tunable thresholds
DEFAULT_ENERGY_THRESHOLD = 0.02   # RMS energy below this = silence
DEFAULT_MIN_SILENCE_SEC = 0.8     # Minimum silence gap to trigger speaker change
DEFAULT_FRAME_DURATION_SEC = 0.03 # 30 ms analysis frames


class EnergyDiarizationService(DiarizationService):
    """
    Lightweight diarization that splits on silence gaps and assigns
    alternating speaker labels. No ML models required.
    """

    def __init__(
        self,
        energy_threshold: float = DEFAULT_ENERGY_THRESHOLD,
        min_silence_sec: float = DEFAULT_MIN_SILENCE_SEC,
        frame_duration_sec: float = DEFAULT_FRAME_DURATION_SEC,
    ):
        self._energy_threshold = energy_threshold
        self._min_silence_sec = min_silence_sec
        self._frame_duration_sec = frame_duration_sec

    @staticmethod
    def _read_wav_frames(audio_path: str, frame_samples: int):
        """Yield (frame_index, rms_energy) tuples from a WAV file."""
        with wave.open(audio_path, "rb") as wf:
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            n_frames = wf.getnframes()

            fmt = {1: "b", 2: "h", 4: "i"}.get(sampwidth, "h")
            max_val = float(2 ** (8 * sampwidth - 1))

            total_samples = n_frames * n_channels
            samples_per_frame = frame_samples * n_channels
            frame_idx = 0

            while True:
                raw = wf.readframes(frame_samples)
                if not raw:
                    break
                count = len(raw) // sampwidth
                values = struct.unpack(f"<{count}{fmt}", raw[: count * sampwidth])
                # Compute RMS
                rms = math.sqrt(sum(v * v for v in values) / max(len(values), 1)) / max_val
                yield frame_idx, rms, framerate
                frame_idx += 1

    async def diarize(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        speaker_names: Optional[List[str]] = None,
    ) -> DiarizationResult:
        start_time = time.monotonic()
        effective_speakers = num_speakers or 2

        def _process():
            # Determine frame size from the WAV sample rate
            segments: List[SpeakerSegment] = []
            current_speaker_idx = 0
            speech_start: Optional[float] = None
            last_speech_end: Optional[float] = None
            framerate = 16000  # fallback

            for frame_idx, rms, fr in self._read_wav_frames(
                audio_path,
                int(fr if 'fr' in dir() else 16000 * self._frame_duration_sec),
            ):
                framerate = fr
                frame_time = frame_idx * self._frame_duration_sec

                if rms >= self._energy_threshold:
                    if speech_start is None:
                        # Check silence gap to decide speaker change
                        if (
                            last_speech_end is not None
                            and (frame_time - last_speech_end) >= self._min_silence_sec
                        ):
                            current_speaker_idx = (
                                (current_speaker_idx + 1) % effective_speakers
                            )
                        speech_start = frame_time
                else:
                    if speech_start is not None:
                        label = f"SPEAKER_{current_speaker_idx:02d}"
                        segments.append(
                            SpeakerSegment(
                                speaker=label,
                                start=round(speech_start, 3),
                                end=round(frame_time, 3),
                            )
                        )
                        last_speech_end = frame_time
                        speech_start = None

            # Flush trailing speech region
            if speech_start is not None:
                label = f"SPEAKER_{current_speaker_idx:02d}"
                segments.append(
                    SpeakerSegment(
                        speaker=label,
                        start=round(speech_start, 3),
                        end=round(speech_start + self._frame_duration_sec, 3),
                    )
                )

            return segments

        segments = await asyncio.to_thread(_process)

        speaker_set = {s.speaker for s in segments}
        ordered_labels = sorted(speaker_set)

        if speaker_names:
            name_map = {
                label: speaker_names[i]
                for i, label in enumerate(ordered_labels)
                if i < len(speaker_names)
            }
            for seg in segments:
                seg.speaker = name_map.get(seg.speaker, seg.speaker)
            ordered_labels = [name_map.get(l, l) for l in ordered_labels]

        elapsed = time.monotonic() - start_time
        return DiarizationResult(
            segments=segments,
            num_speakers=len(speaker_set),
            speaker_labels=ordered_labels,
            backend=self.name,
            processing_time_seconds=round(elapsed, 3),
            metadata={
                "energy_threshold": self._energy_threshold,
                "min_silence_sec": self._min_silence_sec,
            },
        )

    async def is_available(self) -> bool:
        return True  # No external dependencies

    @property
    def name(self) -> str:
        return "energy"
```

### Backend Comparison

| Feature | PyAnnote | Sortformer (NeMo) | Energy-Based |
|---|---|---|---|
| **Accuracy** | ★★★★★ | ★★★★☆ | ★★☆☆☆ |
| **Overlapping speech** | Good | Excellent | None |
| **Auto speaker count** | Yes | Yes | No (defaults to 2) |
| **Dependencies** | `pyannote.audio`, `torch` | `nemo_toolkit`, `torch` | None (stdlib only) |
| **Model download** | ~300 MB | ~500 MB | None |
| **Speed (1 min audio)** | ~5–10 s | ~3–8 s | < 0.5 s |
| **HuggingFace token** | Required | Not required | Not required |
| **Apple Silicon (MPS)** | Supported | Partial | N/A |
| **Use case** | Production default | Overlap-heavy audio | CI / fallback |

---

## 4. Configuration

### 4.1 CLI Arguments

The new server file adds diarization-specific arguments alongside the existing ones:

```bash
python parakeet_with_diarization_server.py \
    --model NeurologyAI/neuro-parakeet-mlx \
    --port 8002 \
    --diarization-backend pyannote \
    --num-speakers 2 \
    --speaker-names "Dr. Weber,Patient" \
    --hf-token hf_XXXXXXXXXXXXXXXXXXXX \
    --streaming-mode http
```

| Argument | Default | Description |
|---|---|---|
| `--diarization-backend` | `energy` | Backend: `pyannote`, `sortformer`, `energy` |
| `--num-speakers` | `None` (auto) | Expected number of speakers |
| `--speaker-names` | `None` | Comma-separated custom speaker names |
| `--hf-token` | `None` | HuggingFace token (for PyAnnote models) |
| `--streaming-mode` | `none` | Streaming mode: `none`, `http`, `websocket` |

### 4.2 Environment Variables

All CLI arguments can also be set via environment variables or a `.env` file:

```bash
# --- Diarization Settings ---
DIARIZATION_BACKEND=pyannote          # pyannote | sortformer | energy
DIARIZATION_NUM_SPEAKERS=             # Empty = auto-detect
DIARIZATION_SPEAKER_NAMES=            # Comma-separated, e.g. "Doctor,Patient"
DIARIZATION_TIMEOUT=300               # Seconds; max time for diarization step
HF_TOKEN=hf_XXXXXXXXXXXXXXXXXXXX      # HuggingFace API token (pyannote)

# --- PyAnnote-Specific ---
PYANNOTE_MODEL=pyannote/speaker-diarization-3.1
PYANNOTE_DEVICE=                      # mps | cpu | cuda (empty = auto)

# --- Sortformer-Specific ---
SORTFORMER_MODEL=nvidia/diar_sortformer_4spk-v1
SORTFORMER_DEVICE=cpu

# --- Energy-Based Specific ---
ENERGY_THRESHOLD=0.02                 # RMS energy threshold for speech
ENERGY_MIN_SILENCE=0.8                # Seconds of silence to split speakers

# --- Streaming Settings ---
STREAMING_MODE=none                   # none | http | websocket
STREAMING_CHUNK_DURATION=5.0          # Seconds per audio chunk (http mode)
WEBSOCKET_MAX_CONNECTIONS=10          # Max concurrent WebSocket clients
```

### 4.3 Backend Auto-Selection

At startup, the server resolves the backend with a fallback chain:

```python
# diarization/factory.py

def create_diarization_service(backend_name: str, **kwargs) -> DiarizationService:
    """
    Instantiate the requested backend.
    Falls back to 'energy' if the requested backend is unavailable.
    """
    registry = {
        "pyannote": ("diarization.backends.pyannote_backend", "PyAnnoteDiarizationService"),
        "sortformer": ("diarization.backends.sortformer_backend", "SortformerDiarizationService"),
        "energy": ("diarization.backends.energy_backend", "EnergyDiarizationService"),
    }

    if backend_name not in registry:
        logger.warning("Unknown backend '%s', falling back to 'energy'", backend_name)
        backend_name = "energy"

    module_path, class_name = registry[backend_name]
    try:
        module = importlib.import_module(module_path)
        service_class = getattr(module, class_name)
        service = service_class(**kwargs)
    except ImportError as exc:
        logger.warning(
            "Backend '%s' unavailable (%s), falling back to 'energy'",
            backend_name, exc,
        )
        from diarization.backends.energy_backend import EnergyDiarizationService
        service = EnergyDiarizationService()

    return service
```

---

## 5. Server Changes

A new file `parakeet_with_diarization_server.py` is created as a **modified copy** of
`parakeet_server.py`. The original file is left untouched to preserve backward
compatibility.

### 5.1 Key Additions

```python
# parakeet_with_diarization_server.py  (additions relative to parakeet_server.py)

from diarization.factory import create_diarization_service
from diarization.merge import merge_transcription_and_diarization
from diarization.service import DiarizationResult

# ---------- Pydantic Response Models ----------

class DiarizedSegment(BaseModel):
    """A single transcription segment with speaker attribution."""
    text: str
    start: Optional[float] = None
    end: Optional[float] = None
    speaker: str = "UNKNOWN"


class DiarizedTranscriptionResponse(BaseModel):
    """Full response for diarized transcription."""
    text: str
    recording_timestamp: Optional[str] = None
    segments: Optional[List[DiarizedSegment]] = None
    speakers: Optional[List[str]] = None
    diarization_backend: Optional[str] = None
    diarization_time_seconds: Optional[float] = None


# ---------- Global Diarization Service ----------

diarization_service: Optional[DiarizationService] = None

# Initialized in lifespan():
#   diarization_service = create_diarization_service(
#       backend_name=args.diarization_backend,
#       hf_token=args.hf_token or os.getenv("HF_TOKEN"),
#       ...
#   )
```

### 5.2 Lifespan Changes

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    global diarization_service

    # ... existing model loading from parakeet_server.py ...

    # Initialize diarization backend
    backend_name = os.getenv("DIARIZATION_BACKEND", "energy")
    diarization_service = create_diarization_service(
        backend_name=backend_name,
        hf_token=os.getenv("HF_TOKEN"),
    )
    available = await diarization_service.is_available()
    if available:
        logger.info("Diarization backend '%s' ready", diarization_service.name)
    else:
        logger.warning(
            "Diarization backend '%s' not available, falling back to 'energy'",
            backend_name,
        )
        from diarization.backends.energy_backend import EnergyDiarizationService
        diarization_service = EnergyDiarizationService()

    yield

    # ... existing shutdown logic ...
```

### 5.3 Concurrent Transcription + Diarization

```python
async def transcribe_and_diarize(
    audio_path: str,
    model,
    num_speakers: Optional[int] = None,
    speaker_names: Optional[List[str]] = None,
    language: Optional[str] = "de",
) -> DiarizedTranscriptionResponse:
    """Run transcription and diarization concurrently, then merge."""

    async def _transcribe():
        def _run():
            try:
                return model.transcribe(audio_path, language=language)
            except TypeError:
                return model.transcribe(audio_path)
        return await asyncio.to_thread(_run)

    async def _diarize():
        return await diarization_service.diarize(
            audio_path,
            num_speakers=num_speakers,
            speaker_names=speaker_names,
        )

    # Run both in parallel
    transcription_result, diarization_result = await asyncio.gather(
        _transcribe(),
        _diarize(),
    )

    # Extract & clean transcription
    text = clean_text(extract_text(transcription_result))
    segments = extract_segments(transcription_result)

    # Merge speaker labels into transcription segments
    merged = merge_transcription_and_diarization(
        transcription_segments=segments,
        diarization_segments=diarization_result.segments,
        speaker_names=speaker_names,
    )

    return DiarizedTranscriptionResponse(
        text=text,
        segments=[DiarizedSegment(**s) for s in merged],
        speakers=diarization_result.speaker_labels,
        diarization_backend=diarization_result.backend,
        diarization_time_seconds=diarization_result.processing_time_seconds,
    )
```

---

## 6. Streaming Support

Two streaming modes are planned for neartime and realtime use cases.

### 6.1 HTTP Chunk-Based Streaming (Neartime)

Uses [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
to push partial results to the client as audio chunks are processed. The client uploads
the full file, and the server streams incremental diarized segments.

**Flow:**

```
Client                              Server
  │                                    │
  │  POST /v1/audio/transcriptions     │
  │  + file + stream=true              │
  │ ──────────────────────────────────►│
  │                                    │  Split audio into chunks
  │                                    │  Process chunk 1
  │  SSE: {"event": "segment", ...}    │
  │ ◄──────────────────────────────────│
  │                                    │  Process chunk 2
  │  SSE: {"event": "segment", ...}    │
  │ ◄──────────────────────────────────│
  │         ...                        │
  │  SSE: {"event": "done", ...}       │
  │ ◄──────────────────────────────────│
  │                                    │
```

**Server implementation sketch:**

```python
from fastapi.responses import StreamingResponse
import json


@app.post("/v1/audio/transcriptions/stream")
async def transcribe_stream(
    file: UploadFile = File(...),
    num_speakers: Optional[int] = Form(None),
    speaker_names: Optional[str] = Form(None),
):
    """Stream diarized transcription results as Server-Sent Events."""

    async def event_generator():
        # Save uploaded file to disk
        audio_path = await save_upload(file)
        try:
            chunks = split_audio_into_chunks(
                audio_path,
                chunk_duration=float(os.getenv("STREAMING_CHUNK_DURATION", "5.0")),
            )
            names = speaker_names.split(",") if speaker_names else None

            for idx, chunk_path in enumerate(chunks):
                result = await transcribe_and_diarize(
                    chunk_path, model,
                    num_speakers=num_speakers,
                    speaker_names=names,
                )
                event_data = json.dumps({
                    "chunk_index": idx,
                    "text": result.text,
                    "segments": [s.dict() for s in result.segments] if result.segments else [],
                    "speakers": result.speakers,
                })
                yield f"event: segment\ndata: {event_data}\n\n"

            yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"
        finally:
            os.unlink(audio_path)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
```

### 6.2 WebSocket-Based Streaming (Realtime)

For true realtime transcription (e.g., live microphone input), the client streams raw
audio frames over a WebSocket and receives diarized text as it becomes available.

**Flow:**

```
Client                              Server
  │                                    │
  │  WS /v1/audio/transcriptions/ws    │
  │ ◄═════════════════════════════════►│  Handshake
  │                                    │
  │  Binary: audio chunk (PCM/WAV)     │
  │ ──────────────────────────────────►│
  │                                    │  Buffer + VAD
  │  JSON: {segment + speaker}         │
  │ ◄──────────────────────────────────│
  │                                    │
  │  Binary: audio chunk               │
  │ ──────────────────────────────────►│
  │  JSON: {segment + speaker}         │
  │ ◄──────────────────────────────────│
  │         ...                        │
  │  Text: "EOS"                       │
  │ ──────────────────────────────────►│
  │  JSON: {final result}              │
  │ ◄──────────────────────────────────│
  │                                    │
```

**Server implementation sketch:**

```python
from fastapi import WebSocket, WebSocketDisconnect
import io

# Connection limiter
_ws_connections = 0
_ws_max = int(os.getenv("WEBSOCKET_MAX_CONNECTIONS", "10"))


@app.websocket("/v1/audio/transcriptions/ws")
async def transcribe_websocket(websocket: WebSocket):
    global _ws_connections
    if _ws_connections >= _ws_max:
        await websocket.close(code=1013, reason="Max connections reached")
        return

    await websocket.accept()
    _ws_connections += 1
    audio_buffer = io.BytesIO()

    try:
        # Receive configuration message first
        config = await websocket.receive_json()
        num_speakers = config.get("num_speakers")
        speaker_names = config.get("speaker_names")
        chunk_duration = config.get("chunk_duration", 5.0)

        accumulated_seconds = 0.0
        sample_rate = config.get("sample_rate", 16000)

        while True:
            message = await websocket.receive()

            if message.get("text") == "EOS":
                # End-of-stream: process remaining buffer
                if audio_buffer.tell() > 0:
                    result = await _process_buffer(
                        audio_buffer, sample_rate, num_speakers, speaker_names
                    )
                    await websocket.send_json({
                        "type": "final",
                        "text": result.text,
                        "segments": [s.dict() for s in result.segments] if result.segments else [],
                        "speakers": result.speakers,
                    })
                await websocket.send_json({"type": "done"})
                break

            if "bytes" in message:
                audio_buffer.write(message["bytes"])
                buffer_seconds = audio_buffer.tell() / (sample_rate * 2)  # 16-bit PCM

                if buffer_seconds >= chunk_duration:
                    result = await _process_buffer(
                        audio_buffer, sample_rate, num_speakers, speaker_names
                    )
                    await websocket.send_json({
                        "type": "partial",
                        "text": result.text,
                        "segments": [s.dict() for s in result.segments] if result.segments else [],
                        "speakers": result.speakers,
                        "offset_seconds": accumulated_seconds,
                    })
                    accumulated_seconds += buffer_seconds
                    audio_buffer = io.BytesIO()  # Reset buffer

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    finally:
        _ws_connections -= 1
        audio_buffer.close()


async def _process_buffer(
    buffer: io.BytesIO,
    sample_rate: int,
    num_speakers,
    speaker_names,
) -> DiarizedTranscriptionResponse:
    """Write buffer to a temp WAV file and process."""
    import wave, tempfile

    buffer.seek(0)
    audio_path = tempfile.mktemp(suffix=".wav")
    try:
        with wave.open(audio_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(sample_rate)
            wf.writeframes(buffer.read())

        return await transcribe_and_diarize(
            audio_path, model,
            num_speakers=num_speakers,
            speaker_names=speaker_names,
        )
    finally:
        if os.path.exists(audio_path):
            os.unlink(audio_path)
```

### 6.3 Streaming Mode Selection

The streaming mode is selected at startup and controls which endpoints are registered:

| Mode | Endpoints Available | Use Case |
|---|---|---|
| `none` | `/v1/audio/transcriptions/diarize` only | Batch processing |
| `http` | Above + `/v1/audio/transcriptions/stream` | Neartime (file upload, chunked SSE) |
| `websocket` | Above + `/v1/audio/transcriptions/ws` | Realtime (live mic, WebSocket) |

```python
# In parakeet_with_diarization_server.py startup

streaming_mode = os.getenv("STREAMING_MODE", "none").lower()

if streaming_mode in ("http", "all"):
    app.add_api_route(
        "/v1/audio/transcriptions/stream",
        transcribe_stream,
        methods=["POST"],
    )

if streaming_mode in ("websocket", "all"):
    app.add_api_websocket_route(
        "/v1/audio/transcriptions/ws",
        transcribe_websocket,
    )
```

---

## 7. API Endpoints

### 7.1 Diarized Transcription (Batch)

```
POST /v1/audio/transcriptions/diarize
```

**Request** (`multipart/form-data`):

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `file` | binary | Yes | — | Audio file (same formats as base endpoint) |
| `model` | string | No | `parakeet-tdt-0.6b-v3` | Transcription model |
| `response_format` | string | No | `json` | `json` or `text` |
| `num_speakers` | integer | No | auto-detect | Expected number of speakers |
| `speaker_names` | string | No | — | Comma-separated speaker names |
| `recording_timestamp` | string | No | — | ISO 8601 timestamp |
| `language` | string | No | `de` | Language hint |

**Response** (`application/json`):

```json
{
  "text": "Full transcribed text of the conversation.",
  "recording_timestamp": "2024-07-20T14:30:00Z",
  "segments": [
    {
      "text": "Good morning, how are you feeling today?",
      "start": 0.0,
      "end": 3.2,
      "speaker": "Dr. Weber"
    },
    {
      "text": "I have been having headaches for two weeks.",
      "start": 3.5,
      "end": 6.8,
      "speaker": "Patient"
    },
    {
      "text": "Can you describe the location and intensity?",
      "start": 7.1,
      "end": 10.0,
      "speaker": "Dr. Weber"
    }
  ],
  "speakers": ["Dr. Weber", "Patient"],
  "diarization_backend": "pyannote",
  "diarization_time_seconds": 4.231
}
```

**cURL example:**

```bash
curl -X POST "http://localhost:8002/v1/audio/transcriptions/diarize" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "file=@consultation.wav" \
  -F "num_speakers=2" \
  -F "speaker_names=Dr. Weber,Patient" \
  -F "response_format=json"
```

### 7.2 Streaming Transcription (SSE)

```
POST /v1/audio/transcriptions/stream
```

Same request parameters as 7.1. Returns `text/event-stream`:

```
event: segment
data: {"chunk_index": 0, "text": "Good morning ...", "segments": [...], "speakers": ["Dr. Weber", "Patient"]}

event: segment
data: {"chunk_index": 1, "text": "I have been ...", "segments": [...], "speakers": ["Dr. Weber", "Patient"]}

event: done
data: {"status": "complete"}
```

### 7.3 WebSocket Transcription (Realtime)

```
WS /v1/audio/transcriptions/ws
```

**Handshake & configuration** (client sends JSON first):

```json
{
  "num_speakers": 2,
  "speaker_names": ["Dr. Weber", "Patient"],
  "sample_rate": 16000,
  "chunk_duration": 5.0
}
```

**Client sends:** binary audio frames (PCM 16-bit mono) or `"EOS"` text message.

**Server sends:**

```json
{
  "type": "partial",
  "text": "Good morning, how are you feeling?",
  "segments": [{"text": "...", "start": 0.0, "end": 3.2, "speaker": "Dr. Weber"}],
  "speakers": ["Dr. Weber", "Patient"],
  "offset_seconds": 0.0
}
```

Final message after `"EOS"`:

```json
{
  "type": "done"
}
```

### 7.4 Diarization Health

```
GET /health/diarization
```

**Response:**

```json
{
  "status": "healthy",
  "backend": "pyannote",
  "backend_available": true,
  "streaming_mode": "http"
}
```

---

## 8. File Structure

```
parakeet-mlx-server/
├── parakeet_server.py                          # UNCHANGED — original server
├── parakeet_with_diarization_server.py         # NEW — extended server with diarization
├── requirements.txt                            # UNCHANGED — base dependencies
├── requirements-diarization.txt                # NEW — diarization-specific deps
│
├── diarization/                                # NEW — diarization package
│   ├── __init__.py                             # Package init, re-exports
│   ├── service.py                              # Abstract base class + data models
│   ├── factory.py                              # Backend auto-selection factory
│   ├── merge.py                                # Transcription ↔ diarization merge
│   └── backends/                               # Backend implementations
│       ├── __init__.py
│       ├── pyannote_backend.py                 # PyAnnote-based diarization
│       ├── sortformer_backend.py               # NeMo Sortformer-based diarization
│       └── energy_backend.py                   # Lightweight energy-based fallback
│
├── tests/
│   ├── test_server.py                          # UNCHANGED — existing tests
│   ├── test_diarization_service.py             # NEW — unit tests for service interface
│   ├── test_diarization_backends.py            # NEW — backend-specific tests
│   ├── test_diarization_merge.py               # NEW — merge logic tests
│   └── test_diarization_endpoints.py           # NEW — API endpoint integration tests
│
├── docs/
│   └── diarization_plan.md                     # THIS FILE
│
├── examples/
│   ├── curl_example.sh                         # UNCHANGED
│   ├── python_client.py                        # UNCHANGED
│   └── diarization_client.py                   # NEW — diarization client example
│
└── start_server.sh                             # MINOR UPDATE — add diarization env vars
```

### New File: `requirements-diarization.txt`

```
# Diarization dependencies (install only what you need)

# --- PyAnnote backend ---
# pyannote.audio>=3.1
# torch>=2.0

# --- Sortformer/NeMo backend ---
# nemo_toolkit[asr]>=2.0
# torch>=2.0

# --- Energy backend ---
# (no additional dependencies — uses Python stdlib only)
```

### New File: `diarization/__init__.py`

```python
"""Speaker diarization plugin for parakeet-mlx-server."""

from diarization.service import (
    DiarizationService,
    DiarizationResult,
    SpeakerSegment,
)
from diarization.factory import create_diarization_service
from diarization.merge import merge_transcription_and_diarization

__all__ = [
    "DiarizationService",
    "DiarizationResult",
    "SpeakerSegment",
    "create_diarization_service",
    "merge_transcription_and_diarization",
]
```

---

## 9. Migration & Rollout Strategy

### Phase 1 — Core Interface & Energy Backend

- Implement `diarization/service.py`, `diarization/merge.py`, `diarization/factory.py`
- Implement `diarization/backends/energy_backend.py`
- Create `parakeet_with_diarization_server.py` with batch endpoint
- Write unit tests for service interface and merge logic
- **Goal:** Working diarized transcription with the zero-dependency backend

### Phase 2 — PyAnnote Backend

- Implement `diarization/backends/pyannote_backend.py`
- Add `requirements-diarization.txt` with PyAnnote dependencies
- Write backend-specific tests (with mocked pipeline)
- Test on Apple Silicon with MPS device
- **Goal:** Production-quality diarization accuracy

### Phase 3 — Sortformer Backend

- Implement `diarization/backends/sortformer_backend.py`
- Test with NeMo toolkit on compatible hardware
- **Goal:** Alternative backend for overlap-heavy audio

### Phase 4 — HTTP Streaming (SSE)

- Implement audio chunking utility
- Add `/v1/audio/transcriptions/stream` endpoint
- Add SSE client example
- **Goal:** Neartime streaming with chunked results

### Phase 5 — WebSocket Streaming

- Implement `/v1/audio/transcriptions/ws` endpoint
- Add WebSocket client example (JavaScript + Python)
- Add connection management and backpressure
- **Goal:** Realtime transcription from live audio sources

### Phase 6 — Documentation & Hardening

- Update `README.md` with diarization section
- Update `PRODUCTION.md` with new environment variables
- Add `examples/diarization_client.py`
- Performance benchmarking on Apple Silicon
- **Goal:** Production-ready release
