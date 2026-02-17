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

## Running on Ubuntu (no Docker)

One script installs everything — PostgreSQL 16, Redis 7, Python 3.12, Node.js 20 — creates the database, and installs all app dependencies.

```bash
# One command — does everything
bash scripts/setup-ubuntu.sh

# Then start the app
bash scripts/start-local.sh
```

That's it. The setup script handles:
- System packages, Python 3.12, Node.js 20
- PostgreSQL 16 install + user/database creation
- Redis install + start
- Python venv + pip install
- npm install for the frontend
- .env generation with random secrets + Fernet key
- Database migrations

| Service    | URL                            |
|------------|--------------------------------|
| Frontend   | http://localhost:3000           |
| API        | http://localhost:8000           |
| API docs   | http://localhost:8000/docs      |

Press **Ctrl+C** to stop, or from another terminal: `bash scripts/stop-local.sh`

### Manual setup (other Linux / macOS)

If you're not on Ubuntu, install the prerequisites yourself then run:

```bash
bash scripts/setup-local.sh       # generate .env + install Python/Node deps
# create PG user + database manually
bash scripts/start-local.sh       # start all services
```

## Development (Docker)

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
