#!/usr/bin/env bash
# Stop the MyFintech AI stack
# Use --volumes (-v) to also remove Qdrant/Ollama/OpenWebUI data

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

docker compose -f "$REPO_ROOT/docker-compose.ai.yml" down "$@"
echo "AI stack stopped."
