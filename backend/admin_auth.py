"""
Admin authentication primitives: password hashing, session tokens, and login
rate limiting. Standard library only (scrypt via hashlib).
"""
import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from typing import Callable

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 1024

# scrypt cost parameters (N=2^14, r=8, p=1: ~16 MB, tens of ms per check).
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 64
_SCRYPT_MAXMEM = 64 * 1024 * 1024


def _b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def hash_password(password: str) -> str:
    """Hash a password as ``scrypt$N$r$p$salt$hash`` (base64 salt and hash)."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
        maxmem=_SCRYPT_MAXMEM,
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64encode(salt)}${_b64encode(digest)}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Constant-time check of a password against a stored scrypt hash."""
    try:
        scheme, n, r, p, salt_b64, hash_b64 = stored_hash.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(hash_b64)
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=base64.b64decode(salt_b64),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
            maxmem=_SCRYPT_MAXMEM,
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)


# Verified against when the username is wrong, so a failed login takes the
# same time whether or not the username exists.
DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(16))


def password_problem(password: str) -> str | None:
    """Why a new password is unacceptable, or None if it's fine."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    if len(password) > MAX_PASSWORD_LENGTH:
        return f"Password must be at most {MAX_PASSWORD_LENGTH} characters."
    return None


def new_session_token() -> str:
    """A fresh, unguessable session token (sent to the browser only)."""
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    """What gets stored server-side, so a database leak can't replay sessions."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class LoginRateLimiter:
    """
    Blocks a client after too many failed logins within a sliding window.

    In-memory, so it resets on restart; fine for the single-worker backend.
    """

    def __init__(
        self,
        max_failures: int = 5,
        window_seconds: float = 15 * 60,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._clock = clock
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str) -> deque[float]:
        failures = self._failures[key]
        cutoff = self._clock() - self.window_seconds
        while failures and failures[0] <= cutoff:
            failures.popleft()
        return failures

    def is_blocked(self, key: str) -> bool:
        """True while ``key`` has too many recent failures."""
        failures = self._prune(key)
        if not failures:
            del self._failures[key]
            return False
        return len(failures) >= self.max_failures

    def record_failure(self, key: str) -> None:
        """Count one failed attempt for ``key``."""
        self._prune(key).append(self._clock())

    def reset(self, key: str) -> None:
        """Forget failures for ``key`` (after a successful login)."""
        self._failures.pop(key, None)
