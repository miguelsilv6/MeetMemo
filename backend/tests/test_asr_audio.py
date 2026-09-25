"""Tests for the ASR-optimized audio derivative."""
import os
import subprocess
from unittest import mock

import pytest
from utils.asr_audio import (
    HIGHPASS_FILTER,
    LOUDNORM_FILTER,
    asr_audio_filter,
    asr_audio_path,
    build_asr_ffmpeg_command,
    prepare_asr_audio,
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
