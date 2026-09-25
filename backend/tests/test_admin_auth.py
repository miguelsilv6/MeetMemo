"""Tests for admin password hashing, tokens and login rate limiting."""
from admin_auth import (
    LoginRateLimiter,
    hash_password,
    hash_session_token,
    new_session_token,
    password_problem,
    verify_password,
)


def test_password_round_trip():
    stored = hash_password("correct horse battery staple")
    assert stored.startswith("scrypt$")
    assert verify_password("correct horse battery staple", stored)
    assert not verify_password("correct horse battery stapler", stored)


def test_hashes_are_salted():
    assert hash_password("same password!!") != hash_password("same password!!")


def test_malformed_or_foreign_hashes_never_verify():
    assert not verify_password("x", "")
    assert not verify_password("x", "bcrypt$whatever")
    assert not verify_password("x", "scrypt$not$numbers$at$all$")


def test_password_policy():
    assert password_problem("short") is not None
    assert password_problem("a" * 12) is None
    assert password_problem("a" * 2000) is not None


def test_session_tokens_are_unique_and_only_their_hash_is_stored():
    token = new_session_token()
    assert token != new_session_token()
    assert len(token) >= 40
    assert hash_session_token(token) == hash_session_token(token)
    assert token not in hash_session_token(token)


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_rate_limiter_blocks_after_max_failures_within_the_window():
    clock = FakeClock()
    limiter = LoginRateLimiter(max_failures=3, window_seconds=60, clock=clock)
    for _ in range(3):
        assert not limiter.is_blocked("1.2.3.4")
        limiter.record_failure("1.2.3.4")
    assert limiter.is_blocked("1.2.3.4")
    assert not limiter.is_blocked("5.6.7.8")

    clock.now += 61
    assert not limiter.is_blocked("1.2.3.4")


def test_rate_limiter_reset_clears_failures():
    limiter = LoginRateLimiter(max_failures=1, window_seconds=60, clock=FakeClock())
    limiter.record_failure("ip")
    assert limiter.is_blocked("ip")
    limiter.reset("ip")
    assert not limiter.is_blocked("ip")
