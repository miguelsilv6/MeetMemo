"""
The diarization model chosen in the admin panel: only allowlisted pipelines
(plus the env's) can be chosen, one pipeline is kept per process and reused
by every audio, switching loads the new one before releasing the old one, a
model that cannot be loaded leaves the current one in place with an error
that says what to do, and each diarization records the model that made it.

torch, torchaudio and pyannote are replaced by fakes: the test dependencies
do not include them.
"""
import asyncio
import importlib
import sys
from types import ModuleType, SimpleNamespace

import pytest
from runtime_settings import DIARIZATION_MODELS, allowed_diarization_models
from services.runtime_settings_service import RuntimeSettingsService

V31, COMMUNITY = DIARIZATION_MODELS


# --- Allowlist ------------------------------------------------------------------


def test_only_known_pipelines_and_the_envs_can_be_chosen():
    assert allowed_diarization_models(V31) == [V31, COMMUNITY]
    assert allowed_diarization_models("my-org/diarization") == [V31, COMMUNITY,
                                                                "my-org/diarization"]
    assert allowed_diarization_models(None) == [V31, COMMUNITY]


class _Repo:
    def __init__(self, stored=None):
        self.stored = stored
        self.saved = None

    async def get_runtime_settings(self):
        return self.stored

    async def save_runtime_settings(self, values, actor, changes):
        self.saved = (values, actor, changes)


def _service(stored=None, env_model=COMMUNITY):
    settings = SimpleNamespace(whisper_model_name="large-v3", job_retention_hours=12,
                               pyannote_model_name=env_model)
    return RuntimeSettingsService(settings, _Repo(stored))


def test_the_default_is_the_envs_pipeline_and_a_choice_is_saved_and_audited():
    service = _service()
    current = asyncio.run(service.get())
    assert current.diarization_model == COMMUNITY  # PYANNOTE_MODEL_NAME / the profile

    changed = asyncio.run(service.update(current.model_copy(update={"diarization_model": V31}),
                                         "admin"))
    assert changed == ["diarization_model"]
    _, actor, changes = service.repo.saved
    assert (actor, changes) == ("admin", [("diarization_model", COMMUNITY, V31)])


def test_an_unknown_pipeline_is_refused_and_a_stale_one_falls_back():
    service = _service()
    current = asyncio.run(service.get())
    with pytest.raises(ValueError, match="diarization"):
        asyncio.run(service.update(
            current.model_copy(update={"diarization_model": "evil/repo"}), "admin"))

    stale = _service(stored={"diarization_model": "removed/model"})
    assert asyncio.run(stale.get()).diarization_model == COMMUNITY


# --- Loading and switching pipelines --------------------------------------------


class _FakePipeline:
    instances = []

    def __init__(self, name):
        self.name = name
        self.device = None
        _FakePipeline.instances.append(self)

    @classmethod
    def from_pretrained(cls, name, token=None):
        if name in _FakePipeline.failing:
            raise OSError("401 Client Error: gated repo")
        return cls(name)

    def to(self, device):
        self.device = device
        return self

    def __call__(self, audio):
        turn = SimpleNamespace(start=0.0, end=1.5)
        annotation = SimpleNamespace(itertracks=lambda yield_label: [(turn, None, "SPEAKER_00")])
        return SimpleNamespace(speaker_diarization=annotation)


@pytest.fixture(name="diarization")
def _diarization_module(monkeypatch):
    """services.diarization_service imported against fake torch/torchaudio/pyannote."""
    torch = ModuleType("torch")
    torch.device = lambda name: f"device:{name}"
    torch.get_num_threads = lambda: 4
    torch.cuda = SimpleNamespace(is_available=lambda: False, empty_cache=lambda: None)
    torchaudio = ModuleType("torchaudio")
    torchaudio.load = lambda path: ("waveform", 16000)
    pyannote = ModuleType("pyannote")
    pyannote_audio = ModuleType("pyannote.audio")
    pyannote_audio.Pipeline = _FakePipeline
    for name, module in (("torch", torch), ("torchaudio", torchaudio),
                         ("pyannote", pyannote), ("pyannote.audio", pyannote_audio)):
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.delitem(sys.modules, "services.diarization_service", raising=False)
    module = importlib.import_module("services.diarization_service")
    _FakePipeline.instances = []
    _FakePipeline.failing = set()
    yield module
    monkeypatch.delitem(sys.modules, "services.diarization_service", raising=False)


def _make(module, job_repo=None):
    settings = SimpleNamespace(pyannote_model_name=V31, hf_token="hf", device="cpu")
    return module.DiarizationService(settings, job_repo)


def test_one_pipeline_is_shared_by_every_request(diarization):
    first = _make(diarization).get_pipeline(V31)
    again = _make(diarization).get_pipeline(V31)  # another request's service

    assert first is again
    assert len(_FakePipeline.instances) == 1
    assert first.device == "device:cpu"
    assert _make(diarization).get_pipeline() is first  # None: the env's model


def test_switching_loads_the_new_pipeline_and_releases_the_old(diarization):
    old = _make(diarization).get_pipeline(V31)
    new = _make(diarization).get_pipeline(COMMUNITY)

    assert (old.name, new.name) == (V31, COMMUNITY)
    assert diarization._loaded_pipeline == (COMMUNITY, new)  # pylint: disable=protected-access


def test_a_pipeline_that_cannot_load_leaves_the_current_one(diarization):
    current = _make(diarization).get_pipeline(V31)
    _FakePipeline.failing.add(COMMUNITY)

    with pytest.raises(diarization.DiarizationModelError) as error:
        _make(diarization).get_pipeline(COMMUNITY)

    assert "accept its conditions on Hugging Face".lower() in str(error.value).lower()
    assert f"https://huggingface.co/{COMMUNITY}" in str(error.value)
    assert _make(diarization).get_pipeline(V31) is current
    assert len(_FakePipeline.instances) == 1


class _JobRepo:
    def __init__(self):
        self.saved = None
        self.states = []

    async def update_workflow_state(self, job_uuid, state, progress):
        self.states.append(state)

    async def update_step_progress(self, job_uuid, progress):
        pass

    async def save_diarization(self, job_uuid, data):
        self.saved = data


def test_each_diarization_records_the_model_that_made_it(diarization):
    repo = _JobRepo()
    data = asyncio.run(_make(diarization, repo).diarize("job", "call.wav", COMMUNITY))

    assert data["model"] == COMMUNITY
    assert data["segments"] == [{"start": 0.0, "end": 1.5, "speaker": "SPEAKER_00"}]
    assert repo.saved == data
    assert repo.states[-1] == "diarized"


def test_a_model_that_cannot_load_fails_the_audio_with_the_reason(diarization, monkeypatch):
    errors = []

    async def update_error(job_uuid, message):
        errors.append(message)

    monkeypatch.setattr(diarization, "update_error", update_error)
    _FakePipeline.failing.add(COMMUNITY)
    repo = _JobRepo()

    with pytest.raises(diarization.DiarizationModelError):
        asyncio.run(_make(diarization, repo).diarize("job", "call.wav", COMMUNITY))

    assert repo.states[-1] == "error"
    assert "Hugging Face" in errors[0]
