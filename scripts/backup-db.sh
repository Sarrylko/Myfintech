#!/usr/bin/env bash
set -euo pipefail

# Daily database backup — run from host or via cron
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="myfintech_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres pg_dump \
    -U "${POSTGRES_USER:-myfintech}" \
    "${POSTGRES_DB:-myfintech}" \
    | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "Backup saved: ${BACKUP_DIR}/${FILENAME}"

# Prune backups older than 30 days
find "$BACKUP_DIR" -name "myfintech_*.sql.gz" -mtime +30 -delete
echo "Old backups pruned."
