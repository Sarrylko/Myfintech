#!/usr/bin/env bash
set -eu

# ─── Start all services locally (no Docker) ────────────────
# Runs API, worker, scheduler, and frontend as background processes.
# Requires: PostgreSQL and Redis already running on localhost.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PIDS_FILE="$ROOT_DIR/.local-pids"

# Load .env
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    . "$ROOT_DIR/.env"
    set +a
else
    echo "ERROR: .env not found. Run 'bash scripts/setup-local.sh' first."
    exit 1
fi

# Clean up on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    if [ -f "$PIDS_FILE" ]; then
        while read -r pid; do
            kill "$pid" 2>/dev/null || true
        done < "$PIDS_FILE"
        rm -f "$PIDS_FILE"
    fi
    echo "All services stopped."
}
trap cleanup EXIT INT TERM

echo "=== Starting MyFintech (local mode) ==="
echo ""

# Clear old pids
rm -f "$PIDS_FILE"

# ─── API (FastAPI + uvicorn) ────────────────────────────────
echo "Starting API on http://localhost:${API_PORT:-8000}..."
cd "$ROOT_DIR/api"
.venv/bin/uvicorn app.main:app \
    --host "${API_HOST:-0.0.0.0}" \
    --port "${API_PORT:-8000}" \
    --reload &
echo $! >> "$PIDS_FILE"

# ─── Celery Worker ──────────────────────────────────────────
echo "Starting Celery worker..."
cd "$ROOT_DIR/api"
.venv/bin/celery -A app.worker worker --loglevel=info --concurrency=2 &
echo $! >> "$PIDS_FILE"

# ─── Celery Beat (scheduler) ───────────────────────────────
echo "Starting Celery beat scheduler..."
cd "$ROOT_DIR/api"
.venv/bin/celery -A app.worker beat --loglevel=info &
echo $! >> "$PIDS_FILE"

# ─── Frontend (Next.js) ─────────────────────────────────────
echo "Starting frontend on http://localhost:3000..."
cd "$ROOT_DIR/frontend"
npm run dev &
echo $! >> "$PIDS_FILE"

echo ""
echo "=== All services running ==="
echo ""
echo "  Frontend:  http://localhost:3000"
echo "  API:       http://localhost:${API_PORT:-8000}"
echo "  API docs:  http://localhost:${API_PORT:-8000}/docs"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

# Wait for any child to exit
wait
