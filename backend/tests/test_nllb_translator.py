"""
The NLLB-200 translation engine: Whisper's languages mapped to NLLB's codes,
segments translated sentence by sentence into Portuguese, the model prepared
once (downloaded from Meta's repository and converted) without ever leaving a
half-converted model behind, and the translation task using it with its own
cache.

The model libraries (ctranslate2, transformers) are replaced by fakes: the
test dependencies do not include them.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from runtime_settings import WHISPER_LANGUAGE_CODES
from services import llm_tasks
from services import nllb_translator as nllb
from services.nllb_translator import (
    NllbEngine,
    NllbUnavailableError,
    UnsupportedLanguageError,
    model_dir,
    nllb_code,
    split_sentences,
)

from tests.test_european_portuguese import (
    JOB,
    TRANSLATE_URL,
    TRANSLATION_URL,
    _client,
    _FakeJobRepository,
    _FakeTasks,
    _FakeTranslator,
    _numbered_segments,
    _settings,
)
from tests.test_european_portuguese import (
    transcripts_api as _transcripts_api,
)

# --- Languages and sentences ---------------------------------------------------


def test_every_whisper_language_nllb_knows_is_mapped():
    assert nllb_code("en") == "eng_Latn"
    assert nllb_code("zh") == "zho_Hans"
    assert set(WHISPER_LANGUAGE_CODES) - set(nllb.LANGUAGE_CODES) == {"br", "haw", "la"}
    assert set(nllb.LANGUAGE_CODES) <= set(WHISPER_LANGUAGE_CODES)


@pytest.mark.parametrize("language", ["la", "haw", None, "", "xx"])
def test_a_language_nllb_lacks_is_refused(language):
    with pytest.raises(UnsupportedLanguageError):
        nllb_code(language)


def test_segments_are_split_into_sentences():
    assert split_sentences("Hello there. How are you? Fine!  Thanks") == [
        "Hello there.", "How are you?", "Fine!", "Thanks",
    ]
    assert split_sentences("  ") == []
    assert split_sentences("v1.2 is out") == ["v1.2 is out"]


def test_the_converted_model_lives_in_the_cache_under_a_safe_name(tmp_path):
    path = model_dir(str(tmp_path), "facebook/nllb-200-distilled-600M")
    assert path == str(tmp_path / "meetmemo-nllb" / "facebook--nllb-200-distilled-600M-ct2-int8")
    # Whatever the name, the model stays in that folder.
    assert os.path.dirname(model_dir(str(tmp_path), "../../etc")) == str(tmp_path / "meetmemo-nllb")


# --- Translating with a loaded model ------------------------------------------


class _FakeTokenizer:
    """Tokens are words; the source language code comes first, as in NLLB."""

    unk_token_id = 3
    known = {"eng_Latn", "fra_Latn", "por_Latn"}

    def __init__(self):
        self.src_lang = None

    def encode(self, text):
        return [self.src_lang, *text.split(), "</s>"]

    def convert_ids_to_tokens(self, ids):
        return list(ids)

    def convert_tokens_to_ids(self, tokens):
        if isinstance(tokens, str):
            return 7 if tokens in self.known else self.unk_token_id
        return list(tokens)

    def decode(self, ids, skip_special_tokens=False):
        assert skip_special_tokens
        return " ".join(t for t in ids if t != "</s>")


class _FakeCt2Translator:
    def __init__(self):
        self.calls = []

    def translate_batch(self, sources, target_prefix, beam_size, max_decoding_length):
        self.calls.append((sources, target_prefix))
        return [
            SimpleNamespace(hypotheses=[[prefix[0], *[f"pt:{t}" for t in source[1:-1]], "</s>"]])
            for source, prefix in zip(sources, target_prefix)
        ]


def _loaded_engine(tmp_path):
    engine = NllbEngine("facebook/nllb-200-distilled-600M", cache_dir=str(tmp_path))
    engine._tokenizer = _FakeTokenizer()  # pylint: disable=protected-access
    engine._translator = _FakeCt2Translator()  # pylint: disable=protected-access
    return engine


def test_segments_are_translated_sentence_by_sentence_into_portuguese(tmp_path):
    engine = _loaded_engine(tmp_path)

    result = engine.translate_texts(["Good morning. See you", "", "Bye"], "en")

    assert result == ["pt:Good pt:morning. pt:See pt:you", "", "pt:Bye"]
    [(sources, prefixes)] = engine._translator.calls  # one batch for all sentences
    assert sources == [
        ["eng_Latn", "Good", "morning.", "</s>"],
        ["eng_Latn", "See", "you", "</s>"],
        ["eng_Latn", "Bye", "</s>"],
    ]
    assert prefixes == [["por_Latn"]] * 3


def test_a_language_the_model_does_not_know_is_refused(tmp_path):
    engine = _loaded_engine(tmp_path)
    with pytest.raises(UnsupportedLanguageError, match="deu_Latn"):
        engine.translate_texts(["Guten Morgen"], "de")


# --- Preparing the model ------------------------------------------------------


def _fake_libraries(monkeypatch, downloads, fail_convert=False):
    """Fake huggingface_hub, ctranslate2 and transformers modules."""
    hub = ModuleType("huggingface_hub")

    def snapshot_download(repo_id, token=None, local_dir=None, allow_patterns=None):
        downloads.append((repo_id, tuple(allow_patterns)))
        os.makedirs(local_dir, exist_ok=True)
        Path(local_dir, "pytorch_model.bin").write_text("float32 weights")
        return local_dir

    hub.snapshot_download = snapshot_download

    class Converter:
        def __init__(self, source):
            assert Path(source, "pytorch_model.bin").exists()

        def convert(self, output_dir, quantization=None, force=False):
            assert quantization == "int8"
            os.makedirs(output_dir, exist_ok=True)
            Path(output_dir, "model.bin").write_text("weights")
            if fail_convert:
                raise RuntimeError("out of memory")

    ct2 = ModuleType("ctranslate2")
    ct2.converters = SimpleNamespace(TransformersConverter=Converter)
    ct2.get_cuda_device_count = lambda: 0
    ct2.Translator = lambda path, device, compute_type: ("translator", path, device, compute_type)

    class AutoTokenizer:
        @staticmethod
        def from_pretrained(path):
            return SimpleNamespace(
                save_pretrained=lambda out: Path(out, "tokenizer.json").write_text("{}"),
                path=path,
            )

    transformers = ModuleType("transformers")
    transformers.AutoTokenizer = AutoTokenizer
    for name, module in (("huggingface_hub", hub), ("ctranslate2", ct2),
                         ("transformers", transformers)):
        monkeypatch.setitem(sys.modules, name, module)


def test_the_model_is_downloaded_from_meta_and_converted_only_once(tmp_path, monkeypatch):
    downloads = []
    _fake_libraries(monkeypatch, downloads)
    engine = NllbEngine("facebook/nllb-200-distilled-600M", cache_dir=str(tmp_path))

    engine.load()
    NllbEngine("facebook/nllb-200-distilled-600M", cache_dir=str(tmp_path)).prepare()

    assert [repo for repo, _ in downloads] == ["facebook/nllb-200-distilled-600M"]
    # Weights and tokenizer only (no code, nothing else from the repository).
    assert set(downloads[0][1]) == {"*.json", "*.model", "*.safetensors", "pytorch_model.bin"}
    assert sorted(os.listdir(engine.path)) == [".meetmemo-ready", "model.bin", "tokenizer.json"]
    # Meta's float32 download is deleted once converted.
    assert os.listdir(tmp_path / "meetmemo-nllb") == [os.path.basename(engine.path)]
    assert engine.loaded
    assert engine._translator == ("translator", engine.path, "cpu", "int8")


def test_a_failed_conversion_leaves_nothing_behind(tmp_path, monkeypatch):
    _fake_libraries(monkeypatch, [], fail_convert=True)
    engine = NllbEngine("facebook/nllb-200-distilled-600M", cache_dir=str(tmp_path))

    with pytest.raises(NllbUnavailableError, match="out of memory"):
        engine.load()

    assert not engine.prepared()
    # Only the download is left, so trying again does not fetch it again.
    assert os.listdir(tmp_path / "meetmemo-nllb") == [os.path.basename(engine.path) + ".download"]
    assert not engine.loaded


def test_missing_libraries_make_the_engine_unavailable(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "ctranslate2", None)  # import fails
    with pytest.raises(NllbUnavailableError, match="library"):
        NllbEngine(cache_dir=str(tmp_path)).load()


# --- The translation task with NLLB -------------------------------------------


class _FakeEngine:
    """Stands in for NllbEngine: "loads" once, translates to "NLLB: <text>"."""

    def __init__(self, fail_load=None):
        self.loaded = False
        self.loads = 0
        self.fail_load = fail_load
        self.batches = []

    def load(self):
        self.loads += 1
        if self.fail_load:
            raise self.fail_load
        self.loaded = True

    def translate_texts(self, texts, language):
        nllb_code(language)
        self.batches.append(len(texts))
        return [f"NLLB: {text}" for text in texts]


def _run_nllb(settings, engine, language="en"):
    tasks = _FakeTasks()
    task = asyncio.run(tasks.enqueue(JOB["uuid"], "translation", {"engine": "nllb"}, "ana"))
    progress = []
    original = tasks.set_progress

    async def record(task_id, done, total):
        progress.append((done, total))
        await original(task_id, done, total)

    tasks.set_progress = record
    runner = llm_tasks.LlmTaskRunner(settings, tasks, _FakeJobRepository(language),
                                     _FakeTranslator(), nllb_engine=engine)
    asyncio.run(runner.run(task))
    return task, progress


def test_an_nllb_task_translates_into_its_own_cache(tmp_path):
    settings = _settings(tmp_path, _numbered_segments(40))
    engine = _FakeEngine()

    task, progress = _run_nllb(settings, engine)

    assert task["status"] == "done"
    assert progress[0] == (0, 0)  # "preparing the engine" while it loads
    assert progress[-1] == (40, 40)
    assert engine.loads == 1
    assert engine.batches == [16, 16, 8]
    translations = Path(settings.translation_dir)
    cached = json.loads((translations / "call.pt-PT.nllb.json").read_text())
    assert cached[3]["text"] == "NLLB: line 3"
    assert cached[3]["speaker"] == "SPEAKER_00"
    assert not (translations / "call.pt-PT.json").exists()  # the LLM's cache is untouched


def test_an_unsupported_language_fails_before_preparing_the_model(tmp_path):
    engine = _FakeEngine()

    task, _ = _run_nllb(_settings(tmp_path), engine, language="la")

    assert (task["status"], task["error_code"]) == ("error", "unsupported_language")
    assert engine.loads == 0


def test_an_engine_that_cannot_load_is_reported(tmp_path):
    engine = _FakeEngine(fail_load=NllbUnavailableError("Could not download: 403"))

    task, _ = _run_nllb(_settings(tmp_path), engine)

    assert (task["status"], task["error_code"]) == ("error", "engine_unavailable")
    assert "403" in task["error"]


def test_the_selected_engine_decides_the_task_and_the_cache_served(tmp_path):
    client, tasks, settings = _client(tmp_path, "en")
    client.app.dependency_overrides[_transcripts_api.get_translation_engine] = lambda: "nllb"
    Path(settings.translation_dir).mkdir()
    (Path(settings.translation_dir) / "call.pt-PT.json").write_text(
        json.dumps([{"speaker": "SPEAKER_00", "text": "Bom dia (LLM)"}]), encoding="utf-8"
    )

    asked = client.post(TRANSLATE_URL)  # the LLM's translation is not NLLB's

    assert asked.status_code == 202
    assert asked.json()["engine"] == "nllb"
    assert tasks.tasks[0]["params"] == {"engine": "nllb"}

    # The panel switches back to the LLM while the NLLB task waits: the page
    # keeps following the NLLB task.
    client.app.dependency_overrides[_transcripts_api.get_translation_engine] = lambda: "llm"
    polled = client.get(TRANSLATION_URL).json()
    assert (polled["status"], polled["engine"]) == ("queued", "nllb")

    runner = llm_tasks.LlmTaskRunner(settings, tasks, _FakeJobRepository("en"),
                                     _FakeTranslator(), nllb_engine=_FakeEngine())
    asyncio.run(runner.run(tasks.tasks[0]))
    done = client.get(TRANSLATION_URL).json()
    # Once done, the task's own translation is served...
    assert (done["status"], done["engine"]) == ("cached", "nllb")
    assert done["segments"][0]["text"] == "NLLB: Good morning"
    # ...and asking again serves the translation of the engine now selected.
    again = client.post(TRANSLATE_URL).json()
    assert (again["status"], again["engine"]) == ("cached", "llm")
    assert again["segments"][0]["text"] == "Bom dia (LLM)"
