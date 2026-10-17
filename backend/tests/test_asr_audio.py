"""Tests for the ASR-optimized audio derivative."""
import json
import os
import subprocess
import wave
from unittest import mock

import numpy as np
import pytest
from utils.asr_audio import (
    HIGHPASS_FILTER,
    LOUDNORM_FILTER,
    asr_audio_filter,
    asr_audio_path,
    build_asr_ffmpeg_command,
    build_channel_asr_command,
    build_probe_command,
    channel_analysis_path,
    channel_asr_path,
    prepare_asr_audio,
    prepare_channel_asr_audio,
)


def test_asr_path_is_keyed_by_job_uuid_in_its_own_subdir():
    assert asr_audio_path("audiofiles", "abc-123") == os.path.join("audiofiles", "asr", "abc-123.wav")


def test_ffmpeg_command_resamples_to_16k_mono_pcm_with_filters():
    cmd = build_asr_ffmpeg_command("in.mp3", "out.wav")
    assert cmd[0] == "ffmpeg"
    assert cmd[cmd.index("-ac") + 1] == "1"
    assert cmd[cmd.index("-ar") + 1] == "16000"
    assert cmd[cmd.index("-c:a") + 1] == "pcm_s16le"
    assert cmd[cmd.index("-af") + 1] == f"{HIGHPASS_FILTER},{LOUDNORM_FILTER}"
    assert cmd[cmd.index("-i") + 1] == "in.mp3"
    assert cmd[-1] == "out.wav"


def test_filter_chain_follows_the_enabled_steps():
    assert asr_audio_filter(True, True) == f"{HIGHPASS_FILTER},{LOUDNORM_FILTER}"
    assert asr_audio_filter(False, True) == LOUDNORM_FILTER
    assert asr_audio_filter(True, False) == HIGHPASS_FILTER
    assert asr_audio_filter(False, False) is None


def test_ffmpeg_command_omits_af_when_all_filters_are_disabled():
    cmd = build_asr_ffmpeg_command("in.mp3", "out.wav", highpass=False, loudnorm=False)
    assert "-af" not in cmd
    assert cmd[cmd.index("-ar") + 1] == "16000"


def test_prepare_writes_via_temp_file_then_renames_into_place(tmp_path):
    output = tmp_path / "asr" / "job.wav"

    def fake_run(cmd, **_kwargs):
        with open(cmd[-1], "wb") as f:
            f.write(b"RIFF")
        return subprocess.CompletedProcess(cmd, 0)

    with mock.patch("utils.asr_audio.subprocess.run", side_effect=fake_run) as run:
        prepare_asr_audio("in.wav", str(output))

    assert run.call_args.args[0][-1] == f"{output}.tmp.wav"
    assert output.read_bytes() == b"RIFF"
    assert not os.path.exists(f"{output}.tmp.wav")


def test_prepare_cleans_up_and_raises_when_ffmpeg_fails(tmp_path):
    output = tmp_path / "asr" / "job.wav"

    def failing_run(cmd, **_kwargs):
        with open(cmd[-1], "wb") as f:
            f.write(b"partial")
        raise subprocess.CalledProcessError(1, cmd, stderr=b"boom")

    with mock.patch("utils.asr_audio.subprocess.run", side_effect=failing_run):
        with pytest.raises(subprocess.CalledProcessError):
            prepare_asr_audio("in.wav", str(output))

    assert not output.exists()
    assert not os.path.exists(f"{output}.tmp.wav")


# --- One derivative per channel ---------------------------------------------


def test_channel_paths_sit_next_to_the_mixed_derivative():
    assert channel_asr_path("audiofiles", "abc", 1) == os.path.join("audiofiles", "asr",
                                                                   "abc.ch1.wav")
    assert channel_analysis_path("audiofiles", "abc") == os.path.join(
        "audiofiles", "asr", "abc.channels.json")


def test_the_probe_is_a_light_two_channel_copy():
    cmd = build_probe_command("in.mp3", "probe.wav")
    assert cmd[cmd.index("-ac") + 1] == "2"  # a mono input becomes two equal channels
    assert cmd[cmd.index("-ar") + 1] == "8000"
    assert cmd[cmd.index("-c:a") + 1] == "pcm_s16le"
    assert cmd[-1] == "probe.wav"


def test_each_channel_is_filtered_on_its_own():
    cmd = build_channel_asr_command("in.wav", ["l.wav", "r.wav"])
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert graph == (
        "[0:a]asplit=2[s0][s1];"
        f"[s0]pan=mono|c0=c0,{HIGHPASS_FILTER},{LOUDNORM_FILTER}[o0];"
        f"[s1]pan=mono|c0=c1,{HIGHPASS_FILTER},{LOUDNORM_FILTER}[o1]"
    )
    assert cmd[cmd.index("-filter_complex") + 2:] == [
        "-map", "[o0]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "l.wav",
        "-map", "[o1]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "r.wav",
    ]
    plain = build_channel_asr_command("in.wav", ["l.wav", "r.wav"], False, False)
    assert "pan=mono|c0=c1[o1]" in plain[plain.index("-filter_complex") + 1]


def _fake_ffmpeg(left, right):
    """A subprocess.run that writes the probe from the given channels, and
    empty WAVs for the per-channel derivatives."""
    def run(cmd, **_kwargs):
        if "-filter_complex" in cmd:
            for i, arg in enumerate(cmd):
                if arg == "pcm_s16le":
                    with open(cmd[i + 1], "wb") as f:
                        f.write(b"RIFF")
        else:
            with wave.open(cmd[-1], "wb") as w:
                w.setnchannels(2)
                w.setsampwidth(2)
                w.setframerate(8000)
                w.writeframes(np.stack([left, right], axis=1).astype("<i2").tobytes())
        return subprocess.CompletedProcess(cmd, 0)
    return run


def test_a_stereo_call_gets_one_derivative_per_channel(tmp_path):
    rng = np.random.default_rng(3)
    left, right = (rng.standard_normal(8000) * 3000 for _ in range(2))
    outputs = [str(tmp_path / "asr" / "j.ch0.wav"), str(tmp_path / "asr" / "j.ch1.wav")]
    analysis_path = str(tmp_path / "asr" / "j.channels.json")

    with mock.patch("utils.asr_audio.subprocess.run", side_effect=_fake_ffmpeg(left, right)):
        analysis = prepare_channel_asr_audio("in.wav", outputs, analysis_path)

    assert analysis["mode"] == "split" and analysis["paths"] == outputs
    assert all(open(p, "rb").read() == b"RIFF" for p in outputs)
    with open(analysis_path, encoding="utf-8") as f:
        assert json.load(f) == analysis
    assert sorted(os.listdir(tmp_path / "asr")) == ["j.ch0.wav", "j.ch1.wav", "j.channels.json"]


def test_mono_saved_as_stereo_gets_no_channel_derivatives(tmp_path):
    voice = np.random.default_rng(4).standard_normal(8000) * 3000
    outputs = [str(tmp_path / "asr" / "j.ch0.wav"), str(tmp_path / "asr" / "j.ch1.wav")]

    with mock.patch("utils.asr_audio.subprocess.run",
                    side_effect=_fake_ffmpeg(voice, voice)) as run:
        analysis = prepare_channel_asr_audio("in.wav", outputs, str(tmp_path / "asr" / "j.json"))

    assert analysis["mode"] == "mono" and "paths" not in analysis
    assert run.call_count == 1  # only the probe
    assert sorted(os.listdir(tmp_path / "asr")) == ["j.json"]
