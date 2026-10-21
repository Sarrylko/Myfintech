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
