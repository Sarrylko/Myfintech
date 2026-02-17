#!/usr/bin/env bash
set -eu

# ─── Setup script for running WITHOUT Docker ───────────────
# Prerequisites: Python 3.11+, Node.js 18+, PostgreSQL 16, Redis 7

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== MyFintech local setup ==="
echo ""

# ─── 1. Generate .env from local template ──────────────────
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE="$ROOT_DIR/.env.local.example"

if [ -f "$ENV_FILE" ]; then
    echo "[skip] .env already exists"
else
    cp "$EXAMPLE" "$ENV_FILE"

    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))" 2>/dev/null || openssl rand -base64 48)
    PG_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))" 2>/dev/null || openssl rand -base64 24)
    FERNET_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null || echo "CHANGE_ME_generate_manually")

    if sed --version >/dev/null 2>&1; then
        sed -i "s|CHANGE_ME_random_secret_key_64_chars|${SECRET_KEY}|g" "$ENV_FILE"
        sed -i "s|CHANGE_ME_postgres|${PG_PASSWORD}|g" "$ENV_FILE"
        sed -i "s|CHANGE_ME_fernet_key|${FERNET_KEY}|g" "$ENV_FILE"
    else
        sed -i '' "s|CHANGE_ME_random_secret_key_64_chars|${SECRET_KEY}|g" "$ENV_FILE"
        sed -i '' "s|CHANGE_ME_postgres|${PG_PASSWORD}|g" "$ENV_FILE"
        sed -i '' "s|CHANGE_ME_fernet_key|${FERNET_KEY}|g" "$ENV_FILE"
    fi

    echo "[done] Created .env with generated secrets"
    echo "       DB password: $PG_PASSWORD  (you'll need this to create the PG user)"
fi

echo ""

# ─── 2. Python virtual environment + deps ──────────────────
echo "--- Setting up Python API ---"
if [ ! -d "$ROOT_DIR/api/.venv" ]; then
    python3 -m venv "$ROOT_DIR/api/.venv"
    echo "[done] Created virtualenv at api/.venv"
else
    echo "[skip] api/.venv already exists"
fi

. "$ROOT_DIR/api/.venv/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r "$ROOT_DIR/api/requirements.txt"
echo "[done] Python dependencies installed"
deactivate

echo ""

# ─── 3. Node.js frontend deps ──────────────────────────────
echo "--- Setting up Next.js frontend ---"
cd "$ROOT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    npm ci
    echo "[done] Node dependencies installed"
else
    echo "[skip] node_modules already exists"
fi

echo ""

# ─── 4. Database setup reminder ─────────────────────────────
echo "=== Manual steps remaining ==="
echo ""
echo "1. Make sure PostgreSQL is running, then create the DB + user:"
echo ""
echo "   sudo -u postgres psql -c \"CREATE USER myfintech WITH PASSWORD '<your_password>';\""
echo "   sudo -u postgres psql -c \"CREATE DATABASE myfintech OWNER myfintech;\""
echo ""
echo "2. Make sure Redis is running:"
echo "   redis-cli ping    # should return PONG"
echo ""
echo "3. Run database migrations:"
echo "   cd api && .venv/bin/alembic upgrade head"
echo ""
echo "4. Start the app:"
echo "   bash scripts/start-local.sh"
echo ""
echo "=== Setup complete ==="
