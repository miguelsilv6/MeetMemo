"""
Startup checks for installed libraries that break the app with a misleading
error: an old Brotli makes every model download fail inside httpx2.
"""
from types import SimpleNamespace

from utils import dependency_checks
from utils.dependency_checks import brotli_too_old, dependency_problems


def _brotli(process):
    return SimpleNamespace(Decompressor=lambda: SimpleNamespace(process=process))


def test_an_old_brotli_is_found():
    def old_process(data):  # Brotli < 1.2: no output_buffer_limit
        return b""

    def new_process(data, output_buffer_limit=None):
        return b""

    assert brotli_too_old(_brotli(old_process)) is True
    assert brotli_too_old(_brotli(new_process)) is False


def test_brotlicffi_is_checked_through_decompress():
    def old_decompress(data):
        return b""

    cffi = SimpleNamespace(Decompressor=lambda: SimpleNamespace(decompress=old_decompress))
    assert brotli_too_old(cffi) is True


def test_no_brotli_is_no_problem(monkeypatch):
    monkeypatch.setattr(dependency_checks, "_brotli_module", lambda: None)
    assert brotli_too_old() is False
    assert not dependency_problems()


def test_the_problem_says_what_fails_and_how_to_fix_it(monkeypatch):
    monkeypatch.setattr(dependency_checks, "_brotli_module",
                        lambda: _brotli(lambda data: b""))

    [problem] = dependency_problems()

    assert "process() takes no keyword arguments" in problem
    assert 'brotli>=1.2.0' in problem
