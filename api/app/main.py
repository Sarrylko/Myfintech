import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import auth, accounts, capital_events, categories, health, investments, plaid, properties, property_details, recurring, rentals, reports, rules, users

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
        ["http://localhost:3000", "http://localhost", f"http://{settings.domain}"]
        if settings.environment == "development"
        else [f"https://{settings.domain}"]
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
app.include_router(rules.router, prefix="/api/v1")
app.include_router(properties.router, prefix="/api/v1")
app.include_router(property_details.router, prefix="/api/v1")
app.include_router(capital_events.router, prefix="/api/v1")
app.include_router(investments.router, prefix="/api/v1")
app.include_router(recurring.router, prefix="/api/v1")
app.include_router(rentals.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
