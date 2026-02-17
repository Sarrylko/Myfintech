#!/usr/bin/env bash
set -eu

# Run Alembic migrations inside the API container
docker compose exec api alembic upgrade head
echo "Migrations applied."
