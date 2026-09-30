"""
Offline translation with Meta's NLLB-200, the alternative to the language model.

The model is Meta's own Hugging Face repository (facebook/nllb-200-distilled-
600M by default), downloaded once (about 2.5 GB of float32 weights) and
converted here to CTranslate2 with int8 weights: about 600 MB, fast on CPU, and
the same runtime faster-whisper already uses. Converting it locally instead of
downloading someone else's converted copy keeps the only thing trusted Meta's
upload. Only the converted model is kept, in the Hugging Face cache volume, so
it survives restarts and is prepared only once (on the first translation, or
ahead of it with ``python -m services.nllb_setup``).

NLLB translates sentences from a known language: the language Whisper detected
is mapped to NLLB's code, and each segment is split into sentences before
translating. Its Portuguese is not specifically European Portuguese.

The model is licensed CC-BY-NC 4.0: non-commercial use only.
"""
import asyncio
import logging
import os
import re
import shutil
import threading
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "facebook/nllb-200-distilled-600M"
TARGET_CODE = "por_Latn"
# Segments translated per block (each block is saved as it completes).
BLOCK_SIZE = 16
BEAM_SIZE = 4
# Longest translation of one sentence, in tokens.
MAX_DECODING_LENGTH = 512
# Where converted models are kept, inside the Hugging Face cache volume.
CACHE_SUBDIR = "meetmemo-nllb"
# Written last, so a conversion cut short is never taken for a finished one.
READY_MARKER = ".meetmemo-ready"

# Whisper's language codes and NLLB's (FLORES-200) code for each. Breton,
# Hawaiian and Latin have none: NLLB does not translate them.
LANGUAGE_CODES = {
    "af": "afr_Latn", "am": "amh_Ethi", "ar": "arb_Arab", "as": "asm_Beng",
    "az": "azj_Latn", "ba": "bak_Cyrl", "be": "bel_Cyrl", "bg": "bul_Cyrl",
    "bn": "ben_Beng", "bo": "bod_Tibt", "bs": "bos_Latn", "ca": "cat_Latn",
    "cs": "ces_Latn", "cy": "cym_Latn", "da": "dan_Latn", "de": "deu_Latn",
    "el": "ell_Grek", "en": "eng_Latn", "es": "spa_Latn", "et": "est_Latn",
    "eu": "eus_Latn", "fa": "pes_Arab", "fi": "fin_Latn", "fo": "fao_Latn",
    "fr": "fra_Latn", "gl": "glg_Latn", "gu": "guj_Gujr", "ha": "hau_Latn",
    "he": "heb_Hebr", "hi": "hin_Deva", "hr": "hrv_Latn", "ht": "hat_Latn",
    "hu": "hun_Latn", "hy": "hye_Armn", "id": "ind_Latn", "is": "isl_Latn",
    "it": "ita_Latn", "ja": "jpn_Jpan", "jw": "jav_Latn", "ka": "kat_Geor",
    "kk": "kaz_Cyrl", "km": "khm_Khmr", "kn": "kan_Knda", "ko": "kor_Hang",
    "lb": "ltz_Latn", "ln": "lin_Latn", "lo": "lao_Laoo", "lt": "lit_Latn",
    "lv": "lvs_Latn", "mg": "plt_Latn", "mi": "mri_Latn", "mk": "mkd_Cyrl",
    "ml": "mal_Mlym", "mn": "khk_Cyrl", "mr": "mar_Deva", "ms": "zsm_Latn",
    "mt": "mlt_Latn", "my": "mya_Mymr", "ne": "npi_Deva", "nl": "nld_Latn",
    "nn": "nno_Latn", "no": "nob_Latn", "oc": "oci_Latn", "pa": "pan_Guru",
    "pl": "pol_Latn", "ps": "pbt_Arab", "pt": "por_Latn", "ro": "ron_Latn",
    "ru": "rus_Cyrl", "sa": "san_Deva", "sd": "snd_Arab", "si": "sin_Sinh",
    "sk": "slk_Latn", "sl": "slv_Latn", "sn": "sna_Latn", "so": "som_Latn",
    "sq": "als_Latn", "sr": "srp_Cyrl", "su": "sun_Latn", "sv": "swe_Latn",
    "sw": "swh_Latn", "ta": "tam_Taml", "te": "tel_Telu", "tg": "tgk_Cyrl",
    "th": "tha_Thai", "tk": "tuk_Latn", "tl": "tgl_Latn", "tr": "tur_Latn",
    "tt": "tat_Cyrl", "uk": "ukr_Cyrl", "ur": "urd_Arab", "uz": "uzn_Latn",
    "vi": "vie_Latn", "yi": "ydd_Hebr", "yo": "yor_Latn", "yue": "yue_Hant",
    "zh": "zho_Hans",
}

# Sentence ends followed by a space (scripts without spaces stay whole).
_SENTENCE_END = re.compile(r"(?<=[.!?…।。！？])\s+")


class NllbUnavailableError(Exception):
    """The NLLB model could not be prepared or loaded."""


class UnsupportedLanguageError(Exception):
    """NLLB does not translate the transcript's language."""


def nllb_code(language: Optional[str]) -> str:
    """NLLB's code for a Whisper language code.

    Raises:
        UnsupportedLanguageError: Unknown language, or one NLLB lacks.
    """
    code = LANGUAGE_CODES.get(language or "")
    if code is None:
        raise UnsupportedLanguageError(
            f"NLLB-200 does not translate the transcript's language ({language or 'unknown'})."
        )
    return code


def split_sentences(text: str) -> list[str]:
    """The text's sentences (NLLB was trained on single sentences)."""
    return [part for part in _SENTENCE_END.split(text.strip()) if part]


def model_dir(cache_dir: str, model_name: str) -> str:
    """Where the converted model is kept."""
    safe = re.sub(r"[^A-Za-z0-9._-]", "--", model_name)
    return os.path.join(cache_dir, CACHE_SUBDIR, f"{safe}-ct2-int8")


def default_cache_dir() -> str:
    """The Hugging Face cache (the volume the models already live in)."""
    return os.environ.get("HF_HOME") or os.path.join(
        os.path.expanduser("~"), ".cache", "huggingface"
    )


class NllbEngine:
    """The NLLB model, prepared and loaded on first use and then kept in memory."""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        device: str = "auto",
        cache_dir: Optional[str] = None,
        hf_token: Optional[str] = None,
    ):
        self.model_name = model_name or DEFAULT_MODEL
        self.device = device or "auto"
        self.cache_dir = cache_dir or default_cache_dir()
        self.hf_token = hf_token or None
        self._lock = threading.Lock()
        self._translator = None
        self._tokenizer = None

    @property
    def path(self) -> str:
        return model_dir(self.cache_dir, self.model_name)

    @property
    def loaded(self) -> bool:
        return self._translator is not None

    def prepared(self) -> bool:
        """Whether the converted model is already on disk."""
        return os.path.exists(os.path.join(self.path, READY_MARKER))

    def prepare(self) -> str:
        """Download Meta's model and convert it, unless done before. Blocking.

        Raises:
            NllbUnavailableError: A library is missing, or the download or
                the conversion failed.
        """
        out_dir = self.path
        if self.prepared():
            return out_dir
        try:
            # pylint: disable=import-outside-toplevel
            import ctranslate2
            import transformers
            from huggingface_hub import snapshot_download
        except ImportError as e:
            raise NllbUnavailableError(f"NLLB-200 needs a library that is missing: {e}") from e

        logger.info("NLLB: downloading %s (first use only)", self.model_name)
        # Downloaded next to the result and deleted once converted: only the
        # converted model (a quarter of the size) is kept.
        download = out_dir + ".download"
        try:
            source = snapshot_download(
                self.model_name,
                token=self.hf_token,
                local_dir=download,
                allow_patterns=[
                    "*.json", "*.model", "*.safetensors", "pytorch_model.bin",
                ],
            )
        except Exception as e:  # pylint: disable=broad-exception-caught
            raise NllbUnavailableError(
                f"Could not download {self.model_name}: {e}"
            ) from e

        logger.info("NLLB: converting %s to CTranslate2 (int8)", self.model_name)
        partial = out_dir + ".partial"
        shutil.rmtree(partial, ignore_errors=True)
        try:
            ctranslate2.converters.TransformersConverter(source).convert(
                partial, quantization="int8", force=True
            )
            transformers.AutoTokenizer.from_pretrained(source).save_pretrained(partial)
            with open(os.path.join(partial, READY_MARKER), "w", encoding="utf-8") as f:
                f.write(self.model_name + "\n")
            shutil.rmtree(out_dir, ignore_errors=True)
            os.replace(partial, out_dir)
        except Exception as e:  # pylint: disable=broad-exception-caught
            # The download is kept, so trying again does not fetch it again.
            shutil.rmtree(partial, ignore_errors=True)
            raise NllbUnavailableError(
                f"Could not convert {self.model_name} for CTranslate2: {e}"
            ) from e
        shutil.rmtree(download, ignore_errors=True)
        logger.info("NLLB: model ready in %s", out_dir)
        return out_dir

    def _device(self, ctranslate2) -> tuple[str, str]:
        device = self.device
        if device == "auto":
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        return device, "int8_float16" if device == "cuda" else "int8"

    def load(self) -> None:
        """Prepare the model if needed and load it. Blocking; safe to call again."""
        with self._lock:
            if self._translator is not None:
                return
            path = self.prepare()
            try:
                # pylint: disable=import-outside-toplevel
                import ctranslate2
                import transformers

                device, compute_type = self._device(ctranslate2)
                tokenizer = transformers.AutoTokenizer.from_pretrained(path)
                translator = ctranslate2.Translator(
                    path, device=device, compute_type=compute_type
                )
            except Exception as e:  # pylint: disable=broad-exception-caught
                raise NllbUnavailableError(f"Could not load NLLB-200: {e}") from e
            logger.info("NLLB: loaded on %s (%s)", device, compute_type)
            self._tokenizer, self._translator = tokenizer, translator

    def supports(self, code: str) -> bool:
        """Whether the loaded tokenizer knows the language code."""
        tokenizer = self._tokenizer
        return tokenizer.convert_tokens_to_ids(code) != tokenizer.unk_token_id

    def translate(self, texts: list[str], source_code: str) -> list[str]:
        """Translate sentences from ``source_code`` into Portuguese. Blocking."""
        self.load()
        if not texts:
            return []
        tokenizer, translator = self._tokenizer, self._translator
        with self._lock:  # the tokenizer's source language is shared state
            tokenizer.src_lang = source_code
            sources = [tokenizer.convert_ids_to_tokens(tokenizer.encode(t)) for t in texts]
        results = translator.translate_batch(
            sources,
            target_prefix=[[TARGET_CODE]] * len(sources),
            beam_size=BEAM_SIZE,
            max_decoding_length=MAX_DECODING_LENGTH,
        )
        translated = []
        for result in results:
            tokens = result.hypotheses[0][1:]  # without the target language code
            translated.append(
                tokenizer.decode(
                    tokenizer.convert_tokens_to_ids(tokens), skip_special_tokens=True
                ).strip()
            )
        return translated

    def translate_texts(self, texts: list[str], language: Optional[str]) -> list[str]:
        """Translate whole segment texts, sentence by sentence. Blocking.

        Raises:
            UnsupportedLanguageError: NLLB does not translate ``language``.
            NllbUnavailableError: The model could not be prepared or loaded.
        """
        code = nllb_code(language)
        self.load()
        if not self.supports(code):
            raise UnsupportedLanguageError(
                f"The NLLB model in use does not know the language code {code}."
            )
        sentences: list[str] = []
        spans: list[tuple[int, int]] = []
        for text in texts:
            parts = split_sentences(text or "")
            spans.append((len(sentences), len(sentences) + len(parts)))
            sentences += parts
        translated = self.translate(sentences, code)
        return [" ".join(translated[start:end]) for start, end in spans]


class NllbSegmentTranslator:
    """Translates transcript segments with NLLB, for the translation task."""

    def __init__(self, engine: NllbEngine, language: Optional[str]):
        self.engine = engine
        self.language = language

    async def translate_segments(self, segments: list[dict]) -> list[dict]:
        texts = [segment.get("text", "") for segment in segments]
        translated = await asyncio.to_thread(self.engine.translate_texts, texts, self.language)
        return [{**segment, "text": text} for segment, text in zip(segments, translated)]


_engine: Optional[NllbEngine] = None
_engine_lock = threading.Lock()


def get_nllb_engine(settings) -> NllbEngine:
    """The one engine of this process (the model is loaded at most once)."""
    global _engine  # pylint: disable=global-statement
    with _engine_lock:
        if _engine is None:
            _engine = NllbEngine(
                getattr(settings, "nllb_model", DEFAULT_MODEL),
                getattr(settings, "nllb_device", "auto"),
                hf_token=getattr(settings, "hf_token", None),
            )
        return _engine
