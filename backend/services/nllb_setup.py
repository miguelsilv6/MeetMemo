"""
Prepare the NLLB-200 translation model ahead of its first use.

    docker compose exec meetmemo-backend python -m services.nllb_setup

Downloads Meta's model, converts it for CTranslate2 and loads it once to
check it works. Without this, the first NLLB translation does the same (and
takes a few minutes longer).
"""
import logging
import sys

from config import get_settings

from services.nllb_translator import NllbUnavailableError, get_nllb_engine


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    engine = get_nllb_engine(get_settings())
    try:
        engine.load()
        sample = engine.translate_texts(["The meeting starts at ten."], "en")[0]
    except NllbUnavailableError as e:
        print(f"NLLB-200 is not available: {e}", file=sys.stderr)
        return 1
    print(f"NLLB-200 ready in {engine.path}")
    print(f"Test: 'The meeting starts at ten.' -> {sample!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
