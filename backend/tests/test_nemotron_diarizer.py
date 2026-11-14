"""
NVIDIA Nemotron 3 Diarization (services/nemotron_diarizer): the audio is made
mono at the model's sampling rate, the model's speaker activity becomes
(start, end, SPEAKER_NN) turns by start time, overlapping speech included.

torch, torchaudio and the model are replaced by fakes: the test dependencies
do not include them (the real model was run by hand on speech audio).
"""
import sys
from contextlib import nullcontext
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest
from services.nemotron_diarizer import NemotronDiarizer


class _Tensor:
    """The bit of a torch tensor the diarizer uses."""

    def __init__(self, array):
        self.array = np.asarray(array, dtype="float32")

    @property
    def ndim(self):
        return self.array.ndim

    def mean(self, dim):
        return _Tensor(self.array.mean(axis=dim))

    def cpu(self):
        return self

    def numpy(self):
        return self.array


class _Inputs(dict):
    attention_mask = "mask"

    def to(self, device, dtype=None):
        self.moved = (device, dtype)
        return self


@pytest.fixture(name="calls")
def _fake_torch(monkeypatch):
    calls = SimpleNamespace(resampled=None, processed=None, model=None)
    torch = ModuleType("torch")
    torch.inference_mode = nullcontext
    torchaudio = ModuleType("torchaudio")

    def resample(audio, rate, wanted):
        calls.resampled = (rate, wanted)
        return _Tensor(audio.array[:: rate // wanted])

    torchaudio.functional = SimpleNamespace(resample=resample)
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "torchaudio", torchaudio)
    return calls


def _diarizer(calls, turns):
    def processor(audio, sampling_rate):
        calls.processed = (audio, sampling_rate)
        return _Inputs(input_features="features")

    processor.feature_extractor = SimpleNamespace(sampling_rate=16000)
    processor.extract_speaker_dict = lambda logits, mask: [turns]

    def model(**inputs):
        calls.model = inputs
        return SimpleNamespace(logits="logits")

    model.device, model.dtype = "device", "dtype"
    return NemotronDiarizer(processor, model)


def test_the_turns_come_out_by_start_time_as_numbered_speakers(calls):
    found = [
        {"Start": 5.0, "End": 8.5, "Speaker": 1},
        {"Start": 0.25, "End": 6.0, "Speaker": 0},  # overlaps the one above
        {"Start": 9.0, "End": 10.0, "Speaker": 7},
    ]
    diarizer = _diarizer(calls, found)

    turns = diarizer.diarize(_Tensor(np.zeros(16000)), 16000)

    assert turns == [(0.25, 6.0, "SPEAKER_00"), (5.0, 8.5, "SPEAKER_01"),
                     (9.0, 10.0, "SPEAKER_07")]
    assert calls.model == {"input_features": "features"}
    assert calls.resampled is None  # already at the model's rate


def test_stereo_at_another_rate_is_made_mono_and_resampled(calls):
    stereo = np.stack([np.full(48000, 1.0), np.full(48000, 3.0)])  # channels x samples
    diarizer = _diarizer(calls, [])

    assert diarizer.diarize(_Tensor(stereo), 48000) == []

    audio, rate = calls.processed
    assert rate == 16000
    assert calls.resampled == (48000, 16000)
    assert audio.shape == (16000,)
    assert set(audio.tolist()) == {2.0}  # the mean of both channels


def test_no_speech_gives_no_turns(calls):
    assert _diarizer(calls, []).diarize(_Tensor(np.zeros(8000)), 16000) == []
