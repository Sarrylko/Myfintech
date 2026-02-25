import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import settings
from app.routers import auth, accounts, budget, capital_events, categories, financial_documents, health, investments, networth, plaid, properties, property_cost_statuses, property_details, property_documents, recurring, rentals, reports, rules, snaptrade, users

logging.basicConfig(
    level=getattr(logging, settings.api_log_level.upper()),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)

# ─── Security headers middleware ───────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if settings.environment != "development":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


# Rate limiter — backed by Redis so limits survive across worker restarts
limiter = Limiter(key_func=get_remote_address, storage_uri=settings.redis_url)

app = FastAPI(
    title="MyFintech API",
    version="0.2.0",
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url=None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

# ─── CORS ──────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        ["http://localhost:3000", "http://localhost", f"http://{settings.domain}"]
        if settings.environment == "development"
        else [f"https://{settings.domain}"]
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"],
)

# ─── Routers ──────────────────────────────────
app.include_router(health.router)
app.include_router(auth.router, prefix="/api/v1")
app.include_router(accounts.router, prefix="/api/v1")
app.include_router(categories.router, prefix="/api/v1")
app.include_router(plaid.router, prefix="/api/v1")
app.include_router(rules.router, prefix="/api/v1")
app.include_router(properties.router, prefix="/api/v1")
app.include_router(property_details.router, prefix="/api/v1")
app.include_router(property_documents.router, prefix="/api/v1")
app.include_router(property_cost_statuses.router, prefix="/api/v1")
app.include_router(financial_documents.router, prefix="/api/v1")
app.include_router(capital_events.router, prefix="/api/v1")
app.include_router(investments.router, prefix="/api/v1")
app.include_router(recurring.router, prefix="/api/v1")
app.include_router(rentals.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(budget.router, prefix="/api/v1")
app.include_router(snaptrade.router, prefix="/api/v1")
app.include_router(networth.router, prefix="/api/v1")
