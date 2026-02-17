import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import auth, accounts, categories, health, plaid, properties, users

logging.basicConfig(
    level=getattr(logging, settings.api_log_level.upper()),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)

app = FastAPI(
    title="MyFintech API",
    version="0.1.0",
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url=None,
)

# ─── CORS ──────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        ["http://localhost:3000", "http://localhost"]
        if settings.environment == "development"
        else [f"https://{settings.domain}"]
        if hasattr(settings, "domain")
        else []
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ──────────────────────────────────
app.include_router(health.router)
app.include_router(auth.router, prefix="/api/v1")
app.include_router(accounts.router, prefix="/api/v1")
app.include_router(categories.router, prefix="/api/v1")
app.include_router(plaid.router, prefix="/api/v1")
app.include_router(properties.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
