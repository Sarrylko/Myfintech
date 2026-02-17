#!/usr/bin/env bash
set -eu

# ─── Stop all locally-running MyFintech services ───────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PIDS_FILE="$ROOT_DIR/.local-pids"

if [ ! -f "$PIDS_FILE" ]; then
    echo "No running services found (.local-pids not present)."
    exit 0
fi

echo "Stopping services..."
while read -r pid; do
    if kill -0 "$pid" 2>/dev/null; then
        kill "$pid"
        echo "  Stopped PID $pid"
    fi
done < "$PIDS_FILE"

rm -f "$PIDS_FILE"
echo "All services stopped."
