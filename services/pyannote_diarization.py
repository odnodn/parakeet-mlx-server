"""PyAnnote-based speaker diarization service.

Uses the ``pyannote.audio`` pipeline for neural speaker diarization.
A HuggingFace authentication token is required because the pre-trained
model is gated.  Set the ``PYANNOTE_AUTH_TOKEN`` environment variable
before instantiating this service.
"""

import logging
import os
from typing import List, Optional

from services.base import (
    DiarizationResult,
    DiarizationService,
    SpeakerSegment,
)

logger = logging.getLogger(__name__)

# Guard optional dependency ---------------------------------------------------
try:
    from pyannote.audio import Pipeline as PyannotePipeline

    _PYANNOTE_AVAILABLE = True
except ImportError:
    _PYANNOTE_AVAILABLE = False


class PyannoteDiarizationService(DiarizationService):
    """Speaker diarization powered by *pyannote.audio*.

    The service lazily loads the ``pyannote/speaker-diarization-3.1``
    pipeline on the first call to :meth:`diarize`.  A valid HuggingFace
    token with access to the gated model must be provided via the
    ``PYANNOTE_AUTH_TOKEN`` environment variable (or passed directly to
    the constructor).

    Args:
        auth_token: HuggingFace authentication token.  Falls back to the
            ``PYANNOTE_AUTH_TOKEN`` environment variable when *None*.
        model_name: Name of the pyannote pipeline to load.
    """

    def __init__(
        self,
        auth_token: Optional[str] = None,
        model_name: str = "pyannote/speaker-diarization-3.1",
    ) -> None:
        self._auth_token = auth_token or os.environ.get("PYANNOTE_AUTH_TOKEN")
        self._model_name = model_name
        self._pipeline: Optional["PyannotePipeline"] = None

    # -- DiarizationService interface ----------------------------------------

    @property
    def name(self) -> str:  # noqa: D401
        return "pyannote"

    def is_available(self) -> bool:
        """Return *True* when ``pyannote.audio`` is importable."""
        return _PYANNOTE_AVAILABLE

    def diarize(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        speaker_names: Optional[List[str]] = None,
    ) -> DiarizationResult:
        """Run the pyannote speaker-diarization pipeline.

        Args:
            audio_path: Path to an audio file supported by *torchaudio*.
            num_speakers: If given, forces the pipeline to detect exactly
                this many speakers.
            speaker_names: Optional list mapping generic labels to readable
                names (e.g., ``["physician", "patient"]``).

        Returns:
            A :class:`DiarizationResult` with speaker-attributed segments.

        Raises:
            RuntimeError: If ``pyannote.audio`` is not installed or if no
                authentication token has been configured.
        """
        if not self.is_available():
            raise RuntimeError(
                "pyannote.audio is not installed. "
                "Install it with: pip install pyannote.audio"
            )

        if not self._auth_token:
            raise RuntimeError(
                "No authentication token provided. "
                "Set the PYANNOTE_AUTH_TOKEN environment variable or pass "
                "auth_token to the constructor."
            )

        pipeline = self._get_pipeline()

        # Build pipeline parameters.
        params: dict = {}
        if num_speakers is not None:
            params["num_speakers"] = num_speakers

        logger.info("Running pyannote diarization on %s …", audio_path)
        diarization = pipeline(audio_path, **params)

        # Build name mapping.
        label_map: dict[str, str] = {}
        if speaker_names:
            for idx, custom in enumerate(speaker_names):
                label_map[f"SPEAKER_{idx}"] = custom

        segments: List[SpeakerSegment] = []
        unique_labels: set[str] = set()

        for turn, _, speaker_label in diarization.itertracks(yield_label=True):
            # Normalize label to SPEAKER_<n> format.
            normalized = self._normalize_label(speaker_label)
            display = label_map.get(normalized, normalized)
            unique_labels.add(display)
            segments.append(
                SpeakerSegment(
                    speaker=display,
                    start=turn.start,
                    end=turn.end,
                )
            )

        sorted_labels = sorted(unique_labels)
        logger.info(
            "Pyannote diarization complete: %d segments, %d speakers.",
            len(segments),
            len(sorted_labels),
        )
        return DiarizationResult(
            segments=segments,
            num_speakers=len(sorted_labels),
            speaker_labels=sorted_labels,
        )

    # -- Internal helpers ----------------------------------------------------

    def _get_pipeline(self) -> "PyannotePipeline":
        """Lazily load and return the pyannote pipeline."""
        if self._pipeline is None:
            logger.info("Loading pyannote pipeline '%s' …", self._model_name)
            self._pipeline = PyannotePipeline.from_pretrained(
                self._model_name, use_auth_token=self._auth_token
            )
        return self._pipeline

    @staticmethod
    def _normalize_label(label: str) -> str:
        """Ensure the speaker label uses the ``SPEAKER_<n>`` convention."""
        if label.startswith("SPEAKER_"):
            return label
        # pyannote may return labels like "SPEAKER_00"; normalize to int index.
        try:
            idx = int(label.replace("SPEAKER_", "").lstrip("0") or "0")
            return f"SPEAKER_{idx}"
        except (ValueError, AttributeError):
            return label
