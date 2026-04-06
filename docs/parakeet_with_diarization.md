# Parakeet-MLX Diarization Server

## Overview

The diarized transcription server (`parakeet_with_diarization_server.py`) extends the base Parakeet-MLX transcription server with **speaker diarization**, **HTTP streaming**, and **WebSocket streaming** capabilities.

### Key Features

- **Speaker diarization** — identify and label who is speaking in multi-speaker audio
- **Multiple diarization backends** — choose from PyAnnote (neural, highest accuracy), NeMo/Sortformer (excellent overlap handling), or energy-based (zero dependencies, instant fallback)
- **HTTP streaming** — process long audio files in chunks with NDJSON streaming responses
- **WebSocket streaming** — real-time bidirectional audio transcription
- **OpenAI-compatible API** — drop-in replacement for the OpenAI audio transcription endpoint
- **Automatic backend selection** — falls back gracefully when preferred backends are unavailable

The server retains full backward compatibility with the original `parakeet_server.py` — the base `/v1/audio/transcriptions` endpoint remains unchanged.

---

## Quick Start

### Install Dependencies

```bash
# Core dependencies
pip install -r requirements.txt

# For PyAnnote backend (recommended for production)
pip install pyannote.audio torch torchaudio

# For NeMo/Sortformer backend
pip install nemo_toolkit[asr] torch
```

### Run the Server

```bash
# Energy-based diarization (no extra dependencies required)
python parakeet_with_diarization_server.py --diarization-backend energy

# Auto-detect best available backend
python parakeet_with_diarization_server.py --diarization-backend auto

# PyAnnote backend (requires HuggingFace token)
PYANNOTE_AUTH_TOKEN=your_hf_token python parakeet_with_diarization_server.py \
    --diarization-backend pyannote

# Sortformer/NeMo backend
python parakeet_with_diarization_server.py --diarization-backend sortformer

# With custom speaker names and count
python parakeet_with_diarization_server.py \
    --diarization-backend pyannote \
    --num-speakers 2 \
    --speaker-names "Doctor,Patient"
```

### Verify It's Running

```bash
curl http://localhost:8002/health
```

Expected response:

```json
{
  "status": "healthy",
  "model_loaded": true,
  "diarization_backend": "pyannote",
  "diarization_available": true,
  "streaming_mode": "http"
}
```

---

## Configuration Reference

### CLI Arguments

| Argument | Default | Description |
|---|---|---|
| `--model` | `PARAKEET_MODEL` env var | Model identifier to load |
| `--port` | `8002` | Server port |
| `--skip-validation` | `false` | Skip system requirements check |
| `--diarization-backend` | `auto` | Backend: `auto`, `pyannote`, `sortformer`, `energy` |
| `--num-speakers` | Auto-detect | Expected number of speakers |
| `--speaker-names` | Generic labels | Comma-separated speaker names (e.g., `"Doctor,Patient"`) |
| `--streaming-mode` | `http` | Streaming mode: `http` or `websocket` |
| `--chunk-duration` | `5.0` | Duration in seconds for each streaming chunk |

### Environment Variables

#### Core

| Variable | Default | Description |
|---|---|---|
| `PARAKEET_MODEL` | `NeurologyAI/neuro-parakeet-mlx` | Model to load for transcription |
| `PORT` | `8002` | Server port |
| `ENV` | `development` | `development` or `production` |
| `API_KEY` | _(none)_ | API key for authentication (required in production) |
| `LOG_LEVEL` | `INFO` | Logging level: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

#### Diarization

| Variable | Default | Description |
|---|---|---|
| `DIARIZATION_BACKEND` | `auto` | Backend to use: `auto`, `pyannote`, `sortformer`, `energy` |
| `DIARIZATION_NUM_SPEAKERS` | _(auto-detect)_ | Expected speaker count; leave empty for auto-detection |
| `DIARIZATION_SPEAKER_NAMES` | _(generic labels)_ | Comma-separated custom names (e.g., `Doctor,Patient`) |
| `PYANNOTE_AUTH_TOKEN` | _(none)_ | HuggingFace auth token for the PyAnnote backend |

#### Streaming

| Variable | Default | Description |
|---|---|---|
| `STREAMING_MODE` | `http` | Streaming protocol: `http` (NDJSON) or `websocket` |
| `STREAMING_CHUNK_DURATION` | `5.0` | Chunk duration in seconds for streaming |

#### Performance & Security

| Variable | Default | Description |
|---|---|---|
| `MAX_CONCURRENT_TRANSCRIPTIONS` | `2` | Maximum simultaneous transcription jobs |
| `TRANSCRIPTION_TIMEOUT` | `600` | Timeout per transcription in seconds |
| `CORS_ORIGINS` | `*` (dev) | Allowed CORS origins (comma-separated) |
| `ALLOW_LAN` | `1` (dev) | Allow local network access |
| `BIND` | `127.0.0.1` | Bind address (`0.0.0.0` for all interfaces) |

---

## API Reference

### GET `/health`

Health check endpoint with diarization status.

**Response:**

```json
{
  "status": "healthy",
  "model_loaded": true,
  "python_version": "3.10.14",
  "system": "darwin",
  "disk_space_gb": 245.5,
  "diarization_backend": "pyannote",
  "diarization_available": true,
  "streaming_mode": "http"
}
```

### GET `/live`

Liveness probe for orchestrators (Kubernetes, etc.).

**Response:**

```json
{"status": "ok"}
```

---

### POST `/v1/audio/transcriptions`

OpenAI-compatible transcription endpoint (unchanged from base server). No diarization is applied.

**Request** (`multipart/form-data`):

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | binary | Yes | Audio file (WAV, MP3, etc.) |
| `model` | string | No | Model name (default: `parakeet-tdt-0.6b-v3`) |
| `response_format` | string | No | `json` (default) or `text` |
| `recording_timestamp` | string | No | ISO 8601 timestamp to attach to the response |

**Response (JSON):**

```json
{
  "text": "Full transcribed text",
  "recording_timestamp": "2024-01-15T09:30:00Z",
  "segments": [
    {
      "text": "segment text",
      "start": 0.0,
      "end": 1.5
    }
  ]
}
```

**cURL example:**

```bash
curl -X POST http://localhost:8002/v1/audio/transcriptions \
  -F "file=@recording.wav" \
  -F "response_format=json"
```

---

### POST `/v1/audio/transcriptions/diarize`

Transcription with speaker diarization.

**Request** (`multipart/form-data`):

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | binary | Yes | Audio file |
| `model` | string | No | Model name |
| `response_format` | string | No | `json` (default) or `text` |
| `recording_timestamp` | string | No | ISO 8601 timestamp |
| `num_speakers` | integer | No | Override expected speaker count |
| `speaker_names` | string | No | Comma-separated names (e.g., `"Doctor,Patient"`) |

**Response (JSON):**

```json
{
  "text": "Good morning, how are you feeling today? I've been having headaches.",
  "recording_timestamp": "2024-01-15T09:30:00Z",
  "segments": [
    {
      "text": "Good morning, how are you feeling today?",
      "start": 0.0,
      "end": 2.3
    },
    {
      "text": "I've been having headaches.",
      "start": 2.5,
      "end": 4.1
    }
  ],
  "speakers": [
    {
      "speaker": "Doctor",
      "start": 0.0,
      "end": 2.3,
      "text": "Good morning, how are you feeling today?"
    },
    {
      "speaker": "Patient",
      "start": 2.5,
      "end": 4.1,
      "text": "I've been having headaches."
    }
  ],
  "num_speakers": 2,
  "speaker_labels": ["Doctor", "Patient"]
}
```

**Response (text):**

```
[Doctor] Good morning, how are you feeling today?
[Patient] I've been having headaches.
```

**cURL examples:**

```bash
# Basic diarization
curl -X POST http://localhost:8002/v1/audio/transcriptions/diarize \
  -F "file=@meeting.wav"

# With speaker names
curl -X POST http://localhost:8002/v1/audio/transcriptions/diarize \
  -F "file=@consultation.wav" \
  -F "num_speakers=2" \
  -F "speaker_names=Doctor,Patient" \
  -F "response_format=json"

# Text format
curl -X POST http://localhost:8002/v1/audio/transcriptions/diarize \
  -F "file=@interview.wav" \
  -F "response_format=text"
```

---

### POST `/v1/audio/transcriptions/stream`

HTTP streaming endpoint that processes audio in chunks and returns results as newline-delimited JSON (NDJSON).

**Request** (`multipart/form-data`):

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | binary | Yes | Audio file (WAV) |
| `model` | string | No | Model name |
| `chunk_duration` | float | No | Override chunk duration in seconds |

**Response** (`application/x-ndjson`):

Results arrive as a stream of JSON objects, one per line:

```json
{"chunk_index": 0, "text": "Good morning everyone, let's begin the meeting.", "is_final": false}
{"chunk_index": 1, "text": "First item on the agenda is the quarterly report.", "is_final": false}
{"chunk_index": 2, "text": "Sales were up fifteen percent.", "is_final": true}
```

On error:

```json
{"chunk_index": 1, "text": "", "is_final": false, "error": "Transcription failed"}
```

**Python client example:**

```python
import requests
import json

with open("long_recording.wav", "rb") as f:
    response = requests.post(
        "http://localhost:8002/v1/audio/transcriptions/stream",
        files={"file": ("audio.wav", f, "audio/wav")},
        data={"chunk_duration": "10.0"},
        stream=True,
    )

for line in response.iter_lines():
    if line:
        chunk = json.loads(line)
        print(f"[Chunk {chunk['chunk_index']}] {chunk['text']}")
        if chunk.get("is_final"):
            print("--- Stream complete ---")
```

**cURL example:**

```bash
curl -N -X POST http://localhost:8002/v1/audio/transcriptions/stream \
  -F "file=@long_audio.wav" \
  -F "chunk_duration=5.0"
```

---

### WS `/v1/audio/transcriptions/ws`

WebSocket endpoint for real-time bidirectional audio transcription with optional diarization.

**Protocol:**

1. **Client connects** to `ws://localhost:8002/v1/audio/transcriptions/ws`
2. **Client sends a JSON config message** (optional):

```json
{
  "num_speakers": 2,
  "speaker_names": ["Doctor", "Patient"],
  "diarize": true
}
```

3. **Client sends binary audio data** (WAV chunks) as binary WebSocket messages
4. **Server responds** with a JSON message per chunk:

```json
{
  "chunk_index": 0,
  "text": "Good morning, how are you?",
  "speakers": [
    {
      "speaker": "Doctor",
      "start": 0.0,
      "end": 1.8,
      "text": "Good morning, how are you?"
    }
  ],
  "num_speakers": 2
}
```

5. **Client sends close control message** (optional):

```json
{"type": "close"}
```

6. **Either side** can close the connection normally.

**Python client example:**

```python
import asyncio
import websockets
import json

async def stream_audio():
    uri = "ws://localhost:8002/v1/audio/transcriptions/ws"

    async with websockets.connect(uri) as ws:
        # Step 1: Send configuration
        config = {
            "num_speakers": 2,
            "speaker_names": ["Doctor", "Patient"],
            "diarize": True,
        }
        await ws.send(json.dumps(config))

        # Step 2: Send audio chunks
        with open("recording.wav", "rb") as f:
            while chunk := f.read(16000 * 2 * 5):  # 5 seconds of 16kHz mono PCM
                await ws.send(chunk)

                # Step 3: Receive transcription result
                result = json.loads(await ws.recv())
                for speaker_seg in result.get("speakers", []):
                    print(f"[{speaker_seg['speaker']}] {speaker_seg['text']}")

        # Step 4: Close
        await ws.send(json.dumps({"type": "close"}))

asyncio.run(stream_audio())
```

---

## Diarization Backends

### Backend Comparison

| Feature | PyAnnote | Sortformer/NeMo | Energy-Based |
|---|---|---|---|
| **Accuracy** | ★★★★★ | ★★★★☆ | ★★☆☆☆ |
| **Overlapping speech** | Good | Excellent | None |
| **Auto speaker count** | Yes | Yes | No (default: 2) |
| **Extra dependencies** | `pyannote.audio`, `torch` | `nemo_toolkit`, `torch` | None |
| **Model download** | ~300 MB | ~500 MB | None |
| **Speed (per 1 min audio)** | 5–10 s | 3–8 s | < 0.5 s |
| **HuggingFace token** | Required | No | No |
| **Apple Silicon (MPS)** | Supported | Partial | N/A |
| **Best for** | Production | Overlap-heavy audio | Testing / CI / fallback |

### PyAnnote

The **PyAnnote** backend uses the `pyannote/speaker-diarization-3.1` pipeline — a state-of-the-art neural speaker diarization model.

**Setup:**

```bash
pip install pyannote.audio torch torchaudio
```

You must accept the model's license on HuggingFace and obtain an auth token:

1. Visit [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) and accept the license.
2. Generate a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).
3. Provide the token via the `PYANNOTE_AUTH_TOKEN` environment variable.

**Capabilities:**
- Neural speaker embedding and clustering
- Automatic speaker count detection
- Accepts a `num_speakers` hint to force a specific count
- Custom speaker name mapping
- MPS acceleration on Apple Silicon

**Limitations:**
- Requires a gated HuggingFace model (license acceptance + auth token)
- ~300 MB initial model download
- Processing time scales with audio length (~5–10 s per minute of audio)
- Requires PyTorch

**Service class:** `PyannoteDiarizationService`

### Sortformer / NeMo

The **Sortformer** backend uses NVIDIA NeMo's multi-scale diarization decoder (MSDD) — designed for high-accuracy diarization including overlapping speech.

**Setup:**

```bash
pip install nemo_toolkit[asr] torch
```

**Capabilities:**
- Frame-level, end-to-end neural diarization
- Excellent handling of overlapping speech
- Voice Activity Detection (VAD) + speaker embeddings + MSDD pipeline
- Automatic and forced speaker count
- Custom speaker name mapping

**Limitations:**
- Large dependency chain (NeMo toolkit + all ASR dependencies)
- ~500 MB model download (`diar_msdd_telephonic`)
- Complex configuration (uses OmegaConf internally)
- Processing time: 3–8 s per minute of audio

**Service class:** `SortformerDiarizationService`

### Energy-Based

The **energy-based** backend is a lightweight, heuristic diarization method with **zero** additional dependencies.

**How it works:**

1. Reads the WAV file as raw PCM samples.
2. Computes RMS energy in fixed-size frames (default: 30 ms).
3. Identifies silence regions where energy falls below a threshold.
4. Assigns alternating speaker labels (`SPEAKER_0`, `SPEAKER_1`, …) at silence boundaries.
5. Merges very short segments to reduce fragmentation.

**When to use it:**
- Development and testing without installing heavy ML frameworks
- CI/CD pipelines
- As a guaranteed fallback when no other backend is available
- Quick prototyping

**Limitations:**
- Does **not** actually identify speakers — it detects turn-taking by silence gaps
- Fixed speaker count (defaults to 2)
- No handling of overlapping speech
- Accuracy depends heavily on recording quality and speaker behavior

**Tunable parameters:**
- `frame_duration_ms` (default: `30`) — analysis frame length
- `energy_threshold_ratio` (default: `0.02`) — silence threshold as a fraction of max energy
- `min_silence_duration` (default: `0.5`) — minimum silence gap to trigger a speaker change
- `min_segment_duration` (default: `0.3`) — merge segments shorter than this value

**Service class:** `EnergyDiarizationService`

### Auto-Selection

When `DIARIZATION_BACKEND=auto` (the default), the factory tries backends in this order:

1. **PyAnnote** — if `pyannote.audio` is installed and a valid auth token is set
2. **Sortformer** — if `nemo_toolkit` is installed
3. **Energy** — always available (guaranteed fallback)

The first backend whose `is_available()` method returns `True` is selected.

---

## Architecture

### File Structure

```
parakeet-mlx-server/
├── parakeet_server.py                    # Original transcription-only server
├── parakeet_with_diarization_server.py   # Extended server with diarization + streaming
├── services/
│   ├── __init__.py                       # Package exports
│   ├── base.py                           # DiarizationService ABC, SpeakerSegment,
│   │                                     #   DiarizationResult, merge utility
│   ├── factory.py                        # create_diarization_service() factory
│   ├── pyannote_diarization.py           # PyAnnote backend
│   ├── sortformer_diarization.py         # NeMo/Sortformer backend
│   └── energy_diarization.py             # Energy-based backend
├── requirements.txt                      # Core dependencies
├── tests/                                # Pytest test suite
├── index.html                            # Web UI
├── start_server.sh                       # Startup script
└── install_server_service.sh             # macOS LaunchAgent installer
```

### Service Interface

All diarization backends implement the `DiarizationService` abstract base class defined in `services/base.py`:

```python
class DiarizationService(ABC):
    @abstractmethod
    def diarize(self, audio_path, num_speakers=None, speaker_names=None) -> DiarizationResult:
        ...

    @abstractmethod
    def is_available(self) -> bool:
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        ...
```

The `DiarizationResult` dataclass contains:

```python
@dataclass
class DiarizationResult:
    segments: List[SpeakerSegment]   # Ordered speaker segments
    num_speakers: int = 0            # Detected speaker count
    speaker_labels: List[str] = []   # Unique labels (e.g., ["SPEAKER_0", "SPEAKER_1"])
```

### Transcription + Diarization Merge

The `merge_transcription_with_diarization()` function in `services/base.py` combines transcription segments (with timing) and diarization segments (with speaker labels) using an **overlap-based assignment** strategy:

1. For each transcription segment, compute the time overlap with every diarization segment.
2. Assign the transcription segment to the diarization speaker with the **greatest overlap**.
3. If custom speaker names are provided, map generic labels (`SPEAKER_0` → `"Doctor"`, etc.).
4. If a transcription segment has no timing information, fall back to the first detected speaker.

```
Transcription:  [0.5s ──── 2.5s]  "Good morning"
                                          ↓ overlap comparison
Diarization:    [0.0s ── 1.5s] SPEAKER_0   [1.5s ──── 5.0s] SPEAKER_1
                    overlap=1.0s                 overlap=1.0s
                                          ↓ tie goes to first match
Result:         SPEAKER_0: "Good morning"
```

---

## Production Deployment

### Recommended Configuration

```bash
# .env or export these before starting the server
export ENV=production
export API_KEY="your-secure-api-key"
export PARAKEET_MODEL="NeurologyAI/neuro-parakeet-mlx"
export PORT=8002
export BIND=127.0.0.1

# Diarization
export DIARIZATION_BACKEND=pyannote
export PYANNOTE_AUTH_TOKEN="hf_your_token"
export DIARIZATION_NUM_SPEAKERS=        # Leave empty for auto-detect

# Performance
export MAX_CONCURRENT_TRANSCRIPTIONS=2
export TRANSCRIPTION_TIMEOUT=600
export STREAMING_CHUNK_DURATION=5.0

# Security
export CORS_ORIGINS="https://your-app.example.com"
export ALLOW_LAN=0
export LOG_LEVEL=INFO
```

Start the server:

```bash
python parakeet_with_diarization_server.py --diarization-backend pyannote --port 8002
```

Or use the provided launch script:

```bash
./start_server.sh
```

For always-on deployment on macOS (e.g., Mac mini), install as a LaunchAgent:

```bash
./install_server_service.sh
```

### Performance Considerations

- **Concurrency** — The `MAX_CONCURRENT_TRANSCRIPTIONS` semaphore limits simultaneous processing to prevent memory exhaustion. The default of `2` is suitable for most setups.
- **Timeouts** — Set `TRANSCRIPTION_TIMEOUT` high enough for your longest expected audio files. At 1× real-time processing speed, a 10-minute file needs at least 600 seconds.
- **Streaming chunk size** — Smaller `STREAMING_CHUNK_DURATION` values provide faster initial results but increase overhead. 5–10 seconds is a good range.

### Resource Requirements by Backend

| Backend | RAM | Disk (models) | GPU/Accelerator |
|---|---|---|---|
| **PyAnnote** | ~2 GB additional | ~300 MB | Optional (MPS on Apple Silicon) |
| **Sortformer** | ~3 GB additional | ~500 MB | Optional (CUDA / MPS) |
| **Energy** | Negligible | None | Not applicable |
| **Base (Parakeet-MLX)** | ~1–2 GB | ~600 MB–1.2 GB | Apple Silicon (MLX) |

### Reverse Proxy

Place the server behind nginx for TLS termination and rate limiting. See the `nginx/` directory for sample configuration. Key points:

- Proxy to `127.0.0.1:8002`
- Increase `client_max_body_size` for large audio uploads
- Set appropriate `proxy_read_timeout` for long transcription jobs
- Enable WebSocket upgrade headers for the `/v1/audio/transcriptions/ws` endpoint

---

## Troubleshooting

### PyAnnote backend not available

**Symptom:** Health endpoint shows `"diarization_backend": null` or falls back to energy.

**Solutions:**
1. Ensure `pyannote.audio` is installed: `pip install pyannote.audio torch torchaudio`
2. Set `PYANNOTE_AUTH_TOKEN` to a valid HuggingFace token
3. Accept the model license at [huggingface.co/pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
4. Check logs for import errors: `LOG_LEVEL=DEBUG python parakeet_with_diarization_server.py`

### Diarization results are inaccurate

**Symptom:** Speakers are mislabeled or segments are attributed to the wrong person.

**Solutions:**
1. Switch to a neural backend (`pyannote` or `sortformer`) if using `energy`
2. Provide `num_speakers` if you know the speaker count in advance
3. Ensure audio quality is sufficient (minimal background noise, clear separation between speakers)
4. For the energy backend, tune `energy_threshold_ratio` and `min_silence_duration`

### Streaming returns empty chunks

**Symptom:** Some NDJSON chunks have empty `text` fields.

**Solutions:**
1. Increase `STREAMING_CHUNK_DURATION` — very short chunks may not contain enough audio for transcription
2. Check that the audio file is a valid WAV
3. Look for timeout errors in the `error` field of the response chunks

### WebSocket connection drops

**Symptom:** WebSocket disconnects mid-stream.

**Solutions:**
1. Check `TRANSCRIPTION_TIMEOUT` is long enough for chunk processing
2. If behind a reverse proxy, increase WebSocket timeout (`proxy_read_timeout`)
3. Implement reconnection logic in your client
4. Send audio chunks at a rate the server can process (wait for each response before sending the next chunk)

### Out of memory

**Symptom:** Server crashes or becomes unresponsive with large files.

**Solutions:**
1. Lower `MAX_CONCURRENT_TRANSCRIPTIONS` to `1`
2. Use streaming endpoints instead of processing the entire file at once
3. Use a lighter diarization backend (energy instead of PyAnnote/Sortformer)
4. Ensure sufficient system RAM (see Resource Requirements table)

### API key rejected in production

**Symptom:** `401 Unauthorized` responses.

**Solutions:**
1. Set the `API_KEY` environment variable before starting the server
2. Include the key in requests: `curl -H "Authorization: Bearer YOUR_KEY" ...`
3. In development mode (`ENV=development`), the API key is optional
