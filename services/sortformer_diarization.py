"""Sortformer / NVIDIA NeMo based speaker diarization service.

Uses the ``nemo_toolkit`` speaker diarization pipeline.  NeMo must be
installed separately (``pip install nemo_toolkit[asr]``).
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
    import nemo.collections.asr as nemo_asr  # noqa: F401
    from omegaconf import OmegaConf  # shipped with NeMo

    _NEMO_AVAILABLE = True
except ImportError:
    _NEMO_AVAILABLE = False


class SortformerDiarizationService(DiarizationService):
    """Speaker diarization powered by NVIDIA NeMo's Sortformer model.

    The service wraps NeMo's ``ClusteringDiarizer`` (or a Sortformer
    end-to-end model when available).  It writes temporary manifest files
    required by NeMo's pipeline and cleans them up afterwards.

    Args:
        model_name: Pretrained NeMo diarization model to use.
        device: Compute device string (e.g., ``"cpu"`` or ``"cuda"``).
    """

    def __init__(
        self,
        model_name: str = "diar_msdd_telephonic",
        device: str = "cpu",
    ) -> None:
        self._model_name = model_name
        self._device = device

    # -- DiarizationService interface ----------------------------------------

    @property
    def name(self) -> str:  # noqa: D401
        return "sortformer"

    def is_available(self) -> bool:
        """Return *True* when ``nemo_toolkit`` is importable."""
        return _NEMO_AVAILABLE

    def diarize(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        speaker_names: Optional[List[str]] = None,
    ) -> DiarizationResult:
        """Run the NeMo speaker diarization pipeline.

        Args:
            audio_path: Path to an audio file.
            num_speakers: Optional hint for the expected number of speakers.
            speaker_names: Optional list of human-readable speaker names.

        Returns:
            A :class:`DiarizationResult`.

        Raises:
            RuntimeError: If ``nemo_toolkit`` is not installed.
        """
        if not self.is_available():
            raise RuntimeError(
                "nemo_toolkit is not installed. "
                "Install it with: pip install nemo_toolkit[asr]"
            )

        # Import here so the module loads even when NeMo is absent.
        from nemo.collections.asr.models import ClusteringDiarizer
        from omegaconf import OmegaConf

        logger.info("Running NeMo diarization on %s …", audio_path)

        # Prepare a minimal NeMo manifest (JSONL with one entry).
        output_dir = os.path.join(os.path.dirname(audio_path) or ".", ".nemo_diar")
        os.makedirs(output_dir, exist_ok=True)

        manifest_path = os.path.join(output_dir, "input_manifest.json")
        import json

        manifest_entry = {
            "audio_filepath": os.path.abspath(audio_path),
            "offset": 0,
            "duration": None,
            "label": "infer",
            "text": "-",
        }
        if num_speakers is not None:
            manifest_entry["num_speakers"] = num_speakers

        with open(manifest_path, "w") as f:
            json.dump(manifest_entry, f)
            f.write("\n")

        # Build a NeMo OmegaConf configuration.
        cfg = OmegaConf.structured(
            {
                "diarizer": {
                    "manifest_filepath": manifest_path,
                    "out_dir": output_dir,
                    "oracle_vad": False,
                    "clustering": {
                        "parameters": {
                            "oracle_num_speakers": num_speakers is not None,
                            "max_num_speakers": num_speakers or 8,
                        }
                    },
                    "vad": {
                        "model_path": "vad_multilingual_marblenet",
                        "parameters": {
                            "onset": 0.8,
                            "offset": 0.6,
                            "min_duration_on": 0.1,
                            "min_duration_off": 0.3,
                        },
                    },
                    "speaker_embeddings": {
                        "model_path": "titanet_large",
                    },
                    "msdd_model": {
                        "model_path": self._model_name,
                        "parameters": {
                            "sigmoid_threshold": [0.7],
                        },
                    },
                }
            }
        )

        diarizer = ClusteringDiarizer(cfg=cfg)
        diarizer.diarize()

        # Parse RTTM output produced by NeMo.
        rttm_path = os.path.join(output_dir, "pred_rttms")
        segments = self._parse_rttm_dir(rttm_path, speaker_names)

        # Clean up temporary files.
        self._cleanup(output_dir)

        unique_labels = sorted({s.speaker for s in segments})
        logger.info(
            "NeMo diarization complete: %d segments, %d speakers.",
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
    def _parse_rttm_dir(
        rttm_dir: str,
        speaker_names: Optional[List[str]] = None,
    ) -> List[SpeakerSegment]:
        """Read all ``.rttm`` files in *rttm_dir* and return speaker segments."""
        label_map: dict[str, str] = {}
        if speaker_names:
            for idx, custom in enumerate(speaker_names):
                label_map[f"SPEAKER_{idx}"] = custom

        segments: List[SpeakerSegment] = []

        if not os.path.isdir(rttm_dir):
            logger.warning("RTTM directory not found: %s", rttm_dir)
            return segments

        for fname in sorted(os.listdir(rttm_dir)):
            if not fname.endswith(".rttm"):
                continue
            filepath = os.path.join(rttm_dir, fname)
            with open(filepath) as fh:
                for line in fh:
                    parts = line.strip().split()
                    if len(parts) < 8 or parts[0] != "SPEAKER":
                        continue
                    start = float(parts[3])
                    duration = float(parts[4])
                    raw_label = parts[7]

                    normalized = SortformerDiarizationService._normalize_label(raw_label)
                    display = label_map.get(normalized, normalized)
                    segments.append(
                        SpeakerSegment(
                            speaker=display,
                            start=start,
                            end=start + duration,
                        )
                    )

        segments.sort(key=lambda s: s.start)
        return segments

    @staticmethod
    def _normalize_label(label: str) -> str:
        """Ensure the speaker label uses the ``SPEAKER_<n>`` convention."""
        if label.startswith("SPEAKER_"):
            try:
                idx = int(label.replace("SPEAKER_", "").lstrip("0") or "0")
                return f"SPEAKER_{idx}"
            except ValueError:
                return label
        return label

    @staticmethod
    def _cleanup(directory: str) -> None:
        """Best-effort removal of the temporary NeMo output directory."""
        import shutil

        try:
            shutil.rmtree(directory)
        except OSError as exc:
            logger.debug("Could not clean up %s: %s", directory, exc)
