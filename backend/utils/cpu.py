"""
CPU capacity available to this process, for sizing inference thread pools.

Counts the CPUs the process may actually run on: its CPU affinity (which
follows a container's or LXC's cpuset), capped by a cgroup CPU quota such as
`docker run --cpus` sets. `os.cpu_count()` alone would report the host's
CPUs, oversubscribing a limited container.
"""
import math
import os
from typing import Optional

CGROUP_V2_CPU_MAX = "/sys/fs/cgroup/cpu.max"
CGROUP_V1_QUOTA = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us"
CGROUP_V1_PERIOD = "/sys/fs/cgroup/cpu/cpu.cfs_period_us"


def _read(path: str) -> Optional[str]:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def cgroup_cpu_quota(
    cpu_max_path: str = CGROUP_V2_CPU_MAX,
    v1_quota_path: str = CGROUP_V1_QUOTA,
    v1_period_path: str = CGROUP_V1_PERIOD,
) -> Optional[float]:
    """The cgroup CPU quota in CPUs (e.g. 2.5), or None when unlimited/unknown."""
    cpu_max = _read(cpu_max_path)
    if cpu_max:
        quota, _, period = cpu_max.partition(" ")
        if quota != "max" and period:
            try:
                return int(quota) / int(period)
            except ValueError:
                return None
        return None

    quota_us, period_us = _read(v1_quota_path), _read(v1_period_path)
    try:
        if quota_us is not None and period_us is not None and int(quota_us) > 0:
            return int(quota_us) / int(period_us)
    except ValueError:
        pass
    return None


def available_cpu_count(quota: Optional[float] = None, use_cgroup: bool = True) -> int:
    """
    Number of CPUs this process can use (at least 1).

    Args:
        quota: CPU quota to apply instead of reading it from the cgroup.
        use_cgroup: Read the cgroup quota when `quota` is not given.
    """
    try:
        count = len(os.sched_getaffinity(0))
    except (AttributeError, OSError):
        count = os.cpu_count() or 1

    if quota is None and use_cgroup:
        quota = cgroup_cpu_quota()
    if quota:
        count = min(count, max(1, math.ceil(quota)))
    return max(1, count)


def whisper_cpu_threads(configured: int, available: int) -> int:
    """Threads for faster-whisper on CPU: the configured count, or every available CPU."""
    return configured if configured > 0 else available
