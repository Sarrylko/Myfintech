#!/usr/bin/env bash
# ─── MyFintech Local Backup ───────────────────────────────────────────────────
# Dumps PostgreSQL + copies .env to Y:\Backups\MyFintech\<timestamp>
# Keeps the last 7 backups and deletes older ones.
# Run manually or via Windows Task Scheduler (scripts\backup.bat)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_ROOT="Y:/Backups/MyFintech"
PROJECT_DIR="C:/Github/MyFinTech/Myfintech"
CONTAINER="myfintech-postgres-1"
DB_USER="myfintech"
DB_NAME="myfintech"
KEEP=7

TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
DEST="$BACKUP_ROOT/$TIMESTAMP"

echo "──────────────────────────────────────────"
echo " MyFintech Backup  —  $TIMESTAMP"
echo "──────────────────────────────────────────"

mkdir -p "$DEST"

# ── 1. PostgreSQL dump ────────────────────────────────────────────────────────
echo "[1/3] Dumping database..."
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" \
  | gzip > "$DEST/myfintech_db.sql.gz"
echo "      Saved: $DEST/myfintech_db.sql.gz ($(du -h "$DEST/myfintech_db.sql.gz" | cut -f1))"

# ── 2. Copy .env ──────────────────────────────────────────────────────────────
echo "[2/3] Copying .env..."
cp "$PROJECT_DIR/.env" "$DEST/.env"
echo "      Saved: $DEST/.env"

# ── 3. Rotate — keep last $KEEP backups ───────────────────────────────────────
echo "[3/3] Rotating old backups (keeping last $KEEP)..."
BACKUP_COUNT=$(ls -1d "$BACKUP_ROOT"/[0-9]*/ 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$KEEP" ]; then
    TO_DELETE=$(ls -1dt "$BACKUP_ROOT"/[0-9]*/ | tail -n +"$((KEEP + 1))")
    echo "$TO_DELETE" | xargs rm -rf
    DELETED=$(echo "$TO_DELETE" | wc -l)
    echo "      Removed $DELETED old backup(s)"
else
    echo "      Nothing to rotate ($BACKUP_COUNT/$KEEP used)"
fi

echo ""
echo "Backup complete → $DEST"
echo "──────────────────────────────────────────"
