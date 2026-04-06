"""Speaker diarization services for parakeet-mlx-server.

This package provides exchangeable speaker diarization backends behind a
common :class:`~services.base.DiarizationService` interface.  Use the
:func:`create_diarization_service` factory to obtain an implementation::

    from services import create_diarization_service

    svc = create_diarization_service("auto")
    result = svc.diarize("recording.wav", num_speakers=2)

Available backends:

* **pyannote** – neural diarization via *pyannote.audio* (requires a
  HuggingFace token).
* **sortformer** – NVIDIA NeMo diarization pipeline.
* **energy** – lightweight energy / silence based heuristic (always
  available).
"""

from services.base import (
    DiarizationResult,
    DiarizationService,
    SpeakerSegment,
    merge_transcription_with_diarization,
)
from services.energy_diarization import EnergyDiarizationService
from services.factory import create_diarization_service
from services.pyannote_diarization import PyannoteDiarizationService
from services.sortformer_diarization import SortformerDiarizationService

__all__ = [
    "DiarizationService",
    "DiarizationResult",
    "SpeakerSegment",
    "PyannoteDiarizationService",
    "SortformerDiarizationService",
    "EnergyDiarizationService",
    "create_diarization_service",
    "merge_transcription_with_diarization",
]
