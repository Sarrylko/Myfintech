#!/usr/bin/env bash
# Start the MyFintech AI stack (Qdrant + Ollama + RAG API + OpenWebUI)
#
# First run: models will be pulled from Ollama registry (~4-6 GB for qwen2.5:7b-instruct)
# Subsequent starts: models load from the cached ollama volume (seconds)
#
# Prerequisites:
#   - Main myfintech stack must be running:  docker compose --profile dev up -d
#   - NVIDIA GPU drivers + nvidia-container-toolkit for GPU acceleration
#   - UPLOADS_HOST_PATH set in .env (defaults to C:/MyFintechUploads)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Building and starting MyFintech AI stack..."
docker compose -f "$REPO_ROOT/docker-compose.ai.yml" up -d --build

echo ""
echo "Waiting for ollama-init to finish pulling models..."
echo "(This may take several minutes on first run — qwen2.5:7b-instruct is ~4 GB)"
docker wait fintech-ollama-init 2>/dev/null || true

echo ""
echo "AI stack is up:"
echo "  OpenWebUI  → http://localhost:3001"
echo "  RAG API    → http://localhost:8001"
echo "  Ollama     → http://localhost:11434"
echo "  Qdrant     → http://localhost:6333"
echo ""
echo "First ingest triggers automatically on startup."
echo "Force re-ingest: curl -X POST http://localhost:8001/admin/ingest"
echo "Check stats:     curl http://localhost:8001/admin/stats"
