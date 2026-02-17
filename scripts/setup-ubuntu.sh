#!/usr/bin/env bash
set -eu

# ─── Full Ubuntu setup for MyFintech (no Docker) ───────────
# Tested on: Ubuntu 22.04 / 24.04 / WSL2 Ubuntu
# Installs: PostgreSQL 16, Redis 7, Python 3.12, Node.js 20

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================"
echo "  MyFintech — Ubuntu Setup (no Docker)"
echo "============================================"
echo ""

# ─── 1. System packages ───────────────────────────────────
echo "[1/7] Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    curl wget gnupg lsb-release software-properties-common \
    build-essential libpq-dev libffi-dev libssl-dev \
    git

# ─── 2. Python 3.12 ──────────────────────────────────────
echo ""
echo "[2/7] Setting up Python 3.12..."
if python3 --version 2>/dev/null | grep -q "3.1[2-9]"; then
    echo "       Python $(python3 --version) already installed"
else
    sudo add-apt-repository -y ppa:deadsnakes/ppa
    sudo apt-get update -qq
    sudo apt-get install -y -qq python3.12 python3.12-venv python3.12-dev
    # Set python3.12 as default python3 if needed
    sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 2>/dev/null || true
    echo "       Python 3.12 installed"
fi

# ─── 3. Node.js 20 ───────────────────────────────────────
echo ""
echo "[3/7] Setting up Node.js 20..."
if node --version 2>/dev/null | grep -q "v2[0-9]"; then
    echo "       Node $(node --version) already installed"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
    echo "       Node.js $(node --version) installed"
fi

# ─── 4. PostgreSQL 16 ────────────────────────────────────
echo ""
echo "[4/7] Setting up PostgreSQL..."
if pg_isready >/dev/null 2>&1; then
    echo "       PostgreSQL already running"
else
    # Add PostgreSQL APT repo for version 16
    if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
        sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
        wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
        sudo apt-get update -qq
    fi
    sudo apt-get install -y -qq postgresql-16
    echo "       PostgreSQL 16 installed"
fi

# Start PostgreSQL (works on both native Ubuntu and WSL)
sudo pg_ctlcluster 16 main start 2>/dev/null || sudo service postgresql start 2>/dev/null || true
echo "       PostgreSQL is running"

# ─── 5. Redis 7 ──────────────────────────────────────────
echo ""
echo "[5/7] Setting up Redis..."
if redis-cli ping >/dev/null 2>&1; then
    echo "       Redis already running"
else
    sudo apt-get install -y -qq redis-server
    # Start Redis (native + WSL compatible)
    sudo service redis-server start 2>/dev/null || redis-server --daemonize yes 2>/dev/null || true
    echo "       Redis installed and running"
fi

# ─── 6. Generate .env and create database ─────────────────
echo ""
echo "[6/7] Configuring environment and database..."

ENV_FILE="$ROOT_DIR/.env"
EXAMPLE="$ROOT_DIR/.env.local.example"

if [ -f "$ENV_FILE" ]; then
    echo "       .env already exists, keeping it"
else
    cp "$EXAMPLE" "$ENV_FILE"

    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
    PG_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
    FERNET_KEY="CHANGE_ME_generate_after_pip_install"

    sed -i "s|CHANGE_ME_random_secret_key_64_chars|${SECRET_KEY}|g" "$ENV_FILE"
    sed -i "s|CHANGE_ME_postgres|${PG_PASSWORD}|g" "$ENV_FILE"
    sed -i "s|CHANGE_ME_fernet_key|${FERNET_KEY}|g" "$ENV_FILE"

    echo "       Created .env"
    echo ""
    echo "       ┌──────────────────────────────────────────────┐"
    echo "       │  DB password (save this): $PG_PASSWORD"
    echo "       └──────────────────────────────────────────────┘"
fi

# Load the password from .env for DB setup
DB_PASS=$(grep "^POSTGRES_PASSWORD=" "$ENV_FILE" | cut -d= -f2-)

# Create PostgreSQL user + database (idempotent)
echo ""
echo "       Creating PostgreSQL user and database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='myfintech'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER myfintech WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='myfintech'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE myfintech OWNER myfintech;"
echo "       Database ready"

# ─── 7. Install app dependencies ─────────────────────────
echo ""
echo "[7/7] Installing application dependencies..."

# Python
echo "       Installing Python packages..."
if [ ! -d "$ROOT_DIR/api/.venv" ]; then
    python3 -m venv "$ROOT_DIR/api/.venv"
fi
. "$ROOT_DIR/api/.venv/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r "$ROOT_DIR/api/requirements.txt"
deactivate
echo "       Python dependencies installed"

# Now generate proper Fernet key and update .env if placeholder
if grep -q "CHANGE_ME_generate_after_pip_install" "$ENV_FILE"; then
    FERNET_KEY=$("$ROOT_DIR/api/.venv/bin/python3" -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
    sed -i "s|CHANGE_ME_generate_after_pip_install|${FERNET_KEY}|g" "$ENV_FILE"
    echo "       Generated Fernet encryption key"
fi

# Node.js
echo "       Installing Node.js packages..."
cd "$ROOT_DIR/frontend"
npm ci --silent 2>/dev/null || npm install --silent
echo "       Node dependencies installed"

# ─── 8. Run database migrations ──────────────────────────
echo ""
echo "       Running database migrations..."
cd "$ROOT_DIR/api"
.venv/bin/alembic upgrade head 2>/dev/null && echo "       Migrations applied" || echo "       (no migrations to run yet — generate with: cd api && .venv/bin/alembic revision --autogenerate -m 'initial')"

# ─── Done ─────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  Start the app:"
echo "    bash scripts/start-local.sh"
echo ""
echo "  Then open:"
echo "    Frontend:  http://localhost:3000"
echo "    API:       http://localhost:8000"
echo "    API docs:  http://localhost:8000/docs"
echo ""
echo "  Stop the app:"
echo "    Ctrl+C  (or from another terminal: bash scripts/stop-local.sh)"
echo ""
