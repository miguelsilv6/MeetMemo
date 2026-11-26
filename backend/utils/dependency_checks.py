"""
Checks, at startup, for installed libraries known to break the app in ways
whose own error message does not tell the cause.

huggingface_hub 2.x downloads models through httpx2, which decodes
brotli-compressed responses with an argument (``output_buffer_limit``) only
Brotli 1.2+ (or brotlicffi 1.2+) accepts. With an older Brotli installed (the
PyTorch base image has one), every first download of a model fails with
"process() takes no keyword arguments".
"""
from types import ModuleType
from typing import Optional

BROTLI_FIX = 'pip install --ignore-installed "brotli>=1.2.0"'


def _brotli_module() -> Optional[ModuleType]:
    """The brotli module httpx2 decodes with, if any."""
    try:
        # pylint: disable-next=import-outside-toplevel
        from httpx2 import _decoders  # noqa: PLC0415
    except ImportError:
        return None
    return getattr(_decoders, "brotli", None)


def brotli_too_old(module: Optional[ModuleType] = None) -> bool:
    """Whether the installed Brotli lacks what httpx2 needs to decode a response."""
    brotli = module if module is not None else _brotli_module()
    if brotli is None:
        return False  # not installed: httpx2 does not ask for brotli at all
    decompressor = brotli.Decompressor()
    # brotlicffi decompresses with decompress(), the Brotli package with process().
    decode = getattr(decompressor, "decompress", None) or decompressor.process
    try:
        decode(b"", output_buffer_limit=1)
    except TypeError:
        return True
    except Exception:  # pylint: disable=broad-exception-caught
        return False  # some other complaint about the empty input: the argument is known
    return False


def dependency_problems() -> list[str]:
    """What is wrong with the installed libraries, as messages for the log."""
    problems = []
    if brotli_too_old():
        problems.append(
            "The installed Brotli is older than 1.2: downloading any model not yet in the "
            "cache will fail with 'process() takes no keyword arguments'. Install a newer "
            f"one in the backend ({BROTLI_FIX}) and restart it; rebuilding the image "
            "(docker compose up -d --build) does that too."
        )
    return problems
