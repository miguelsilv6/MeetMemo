"""What can be told about an uploaded audio without decoding it."""
import logging
import wave
from typing import Optional

logger = logging.getLogger(__name__)


def wav_seconds(path: str) -> Optional[float]:
    """How long a WAV file plays (from its header), or None if it cannot be read."""
    try:
        with wave.open(path, "rb") as wav:
            rate = wav.getframerate()
            return wav.getnframes() / rate if rate else None
    except (OSError, EOFError, wave.Error) as e:
        logger.debug("Could not read the length of %s: %s", path, e)
        return None
