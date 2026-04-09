"""Factory for creating diarization service instances.

The :func:`create_diarization_service` function is the recommended entry
point.  It accepts a backend name (``"pyannote"``, ``"sortformer"``,
``"energy"``, or ``"auto"``) and returns a ready-to-use
:class:`~services.base.DiarizationService`.
"""

import logging
from typing import Optional

from services.base import DiarizationService
from services.energy_diarization import EnergyDiarizationService
from services.pyannote_diarization import PyannoteDiarizationService
from services.sortformer_diarization import SortformerDiarizationService

logger = logging.getLogger(__name__)

# Preferred order for auto-detection.
_AUTO_ORDER = [
    ("pyannote", PyannoteDiarizationService),
    ("sortformer", SortformerDiarizationService),
    ("energy", EnergyDiarizationService),
]

_BACKENDS: dict[str, type] = {
    "pyannote": PyannoteDiarizationService,
    "sortformer": SortformerDiarizationService,
    "energy": EnergyDiarizationService,
}


def create_diarization_service(
    backend: str = "auto",
    **kwargs,
) -> DiarizationService:
    """Create a diarization service for the requested backend.

    Args:
        backend: One of ``"pyannote"``, ``"sortformer"``, ``"energy"``, or
            ``"auto"``.  When ``"auto"`` is chosen the function tries each
            backend in preference order (pyannote → sortformer → energy) and
            returns the first one whose :meth:`is_available` returns *True*.
        **kwargs: Extra keyword arguments forwarded to the backend
            constructor (e.g., ``auth_token`` for pyannote).

    Returns:
        A :class:`~services.base.DiarizationService` instance.

    Raises:
        ValueError: If *backend* is not recognised.
        RuntimeError: If *backend* is ``"auto"`` and no backend is available
            (should not happen since the energy backend has no optional
            dependencies).
    """
    if backend == "auto":
        return _auto_select(**kwargs)

    cls = _BACKENDS.get(backend)
    if cls is None:
        available = ", ".join(sorted(set(_BACKENDS) | {"auto"}))
        raise ValueError(
            f"Unknown diarization backend '{backend}'. "
            f"Available backends: {available}"
        )

    service = cls(**kwargs)
    if not service.is_available():
        _install_hints: dict[str, str] = {
            "sortformer": "pip install nemo_toolkit[asr]",
            "pyannote": (
                "pip install pyannote.audio  "
                "(also set PYANNOTE_AUTH_TOKEN)"
            ),
        }
        hint = _install_hints.get(backend, "")
        hint_msg = f"  Install with: {hint}" if hint else ""
        raise RuntimeError(
            f"Diarization backend '{backend}' is not available — "
            f"its dependencies are not installed.{hint_msg}"
        )

    logger.info("Using diarization backend: %s", service.name)
    return service


def _auto_select(**kwargs) -> DiarizationService:
    """Try backends in preference order and return the first available one."""
    for name, cls in _AUTO_ORDER:
        try:
            service = cls(**kwargs)
            if service.is_available():
                logger.info(
                    "Auto-selected diarization backend: %s", service.name
                )
                return service
        except Exception:
            logger.debug("Backend '%s' could not be instantiated.", name, exc_info=True)

    # Energy should always be available, but be defensive.
    raise RuntimeError("No diarization backend is available.")
