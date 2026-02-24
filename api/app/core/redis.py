import redis.asyncio as aioredis

from app.core.config import settings

# Shared async Redis client (created once at import time, reused across requests)
_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


_BLACKLIST_PREFIX = "rt_blacklist:"


async def blacklist_token(jti: str, ttl_seconds: int) -> None:
    """Add a refresh token JTI to the blacklist for its remaining lifetime."""
    if ttl_seconds > 0:
        await get_redis().setex(f"{_BLACKLIST_PREFIX}{jti}", ttl_seconds, "1")


async def is_blacklisted(jti: str) -> bool:
    """Return True if this JTI has been revoked."""
    return await get_redis().exists(f"{_BLACKLIST_PREFIX}{jti}") == 1


# ─── Login lockout ─────────────────────────────────────────────────────────────

_FAIL_PREFIX = "login_fails:"
_LOCKOUT_SECONDS = 15 * 60   # 15-minute lockout window
_MAX_ATTEMPTS = 5            # failures before lockout triggers


async def record_login_failure(email: str) -> int:
    """Increment failure counter; set TTL on first failure. Returns new count."""
    r = get_redis()
    key = f"{_FAIL_PREFIX}{email.lower()}"
    count = await r.incr(key)
    if count == 1:
        # First failure: start the lockout window
        await r.expire(key, _LOCKOUT_SECONDS)
    return count


async def is_locked_out(email: str) -> bool:
    """Return True if this account is currently locked out."""
    count = await get_redis().get(f"{_FAIL_PREFIX}{email.lower()}")
    return int(count) >= _MAX_ATTEMPTS if count else False


async def clear_login_failures(email: str) -> None:
    """Remove failure counter after a successful login."""
    await get_redis().delete(f"{_FAIL_PREFIX}{email.lower()}")
