# MyFintech

Self-hosted personal finance dashboard — track bank accounts, budgets, investments, real estate, and net worth in one place.

## Architecture

| Service       | Tech            | Purpose                          |
|---------------|-----------------|----------------------------------|
| **frontend**  | Next.js 14      | Dashboards, budgets, rules UI    |
| **api**       | FastAPI          | Business logic, auth, REST API   |
| **worker**    | Celery           | Background sync & enrichment     |
| **scheduler** | Celery Beat      | Periodic refresh & snapshots     |
| **postgres**  | PostgreSQL 16    | Primary database                 |
| **redis**     | Redis 7          | Task queue & caching             |
| **proxy**     | Caddy            | HTTPS, routing, reverse proxy    |

## Quick Start

```bash
# 1. Generate .env with random secrets
./scripts/init-env.sh

# 2. Edit .env — add your Plaid keys and other config
nano .env

# 3. Start everything
docker compose up -d

# 4. Run database migrations
./scripts/migrate.sh

# 5. Open the app
open http://localhost
```

## Development

```bash
# Start with dev tools (includes Adminer at :8080)
COMPOSE_PROFILES=dev docker compose up -d

# API docs available at http://localhost:8000/docs
# Adminer at http://localhost:8080
```

## Project Structure

```
├── api/                    # FastAPI backend
│   ├── app/
│   │   ├── core/           # Config, database, security, deps
│   │   ├── models/         # SQLAlchemy models
│   │   ├── routers/        # API endpoints
│   │   ├── schemas/        # Pydantic schemas
│   │   ├── services/       # Background task logic
│   │   ├── main.py         # FastAPI app entry
│   │   └── worker.py       # Celery app + beat schedule
│   ├── alembic/            # Database migrations
│   └── Dockerfile
├── frontend/               # Next.js frontend
│   ├── src/
│   │   ├── app/            # App Router pages
│   │   ├── components/     # Reusable UI components
│   │   ├── lib/            # API client, utilities
│   │   └── styles/         # Global styles
│   └── Dockerfile
├── proxy/                  # Caddy reverse proxy config
├── scripts/                # Utility scripts
├── docker-compose.yml      # Full stack definition
└── .env.example            # Environment template
```

## Build Phases

- **Phase A** — Platform foundation (Docker, auth, schema, health) ✓
- **Phase B** — Plaid banking + transactions (MVP)
- **Phase C** — Budgets + reporting
- **Phase D** — Brokerage / investments
- **Phase E** — Real estate + net worth
- **Phase F** — Hardening (encryption, backups, HTTPS, MFA)

## Key Design Decisions

- **Idempotent sync**: Transactions keyed by `plaid_transaction_id` — re-running never duplicates
- **Encrypted tokens**: Plaid access tokens encrypted at rest with Fernet
- **Household model**: Multi-user support with owner/member roles
- **Rule-based categorization**: Pattern matching first, ML later
- **Separate networks**: Proxy on `public`, DB/Redis on `private` (not internet-accessible)
