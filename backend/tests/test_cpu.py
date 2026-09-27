"""CPU capacity detection used to size the transcription thread pool."""
import os

from utils.cpu import available_cpu_count, cgroup_cpu_quota, whisper_cpu_threads


def _write(path, text):
    path.write_text(text, encoding="utf-8")
    return str(path)


def test_cgroup_v2_quota_is_read_in_cpus(tmp_path):
    cpu_max = _write(tmp_path / "cpu.max", "250000 100000\n")
    assert cgroup_cpu_quota(cpu_max, "/missing", "/missing") == 2.5


def test_cgroup_v2_without_a_limit_has_no_quota(tmp_path):
    cpu_max = _write(tmp_path / "cpu.max", "max 100000\n")
    assert cgroup_cpu_quota(cpu_max, "/missing", "/missing") is None


def test_cgroup_v1_quota_is_read_in_cpus(tmp_path):
    quota = _write(tmp_path / "quota", "400000")
    period = _write(tmp_path / "period", "100000")
    assert cgroup_cpu_quota("/missing", quota, period) == 4


def test_cgroup_v1_without_a_limit_has_no_quota(tmp_path):
    quota = _write(tmp_path / "quota", "-1")
    period = _write(tmp_path / "period", "100000")
    assert cgroup_cpu_quota("/missing", quota, period) is None


def test_no_cgroup_files_means_no_quota():
    assert cgroup_cpu_quota("/missing", "/missing", "/missing") is None


def test_available_cpus_follow_the_affinity_mask(monkeypatch):
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(10)), raising=False)
    assert available_cpu_count(use_cgroup=False) == 10


def test_a_cpu_quota_caps_the_count_rounding_up(monkeypatch):
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(10)), raising=False)
    assert available_cpu_count(quota=2.5) == 3
    assert available_cpu_count(quota=0.2) == 1
    # A quota above the affinity mask changes nothing.
    assert available_cpu_count(quota=16) == 10


def test_whisper_uses_every_available_cpu_unless_configured():
    assert whisper_cpu_threads(0, 10) == 10
    assert whisper_cpu_threads(6, 10) == 6
