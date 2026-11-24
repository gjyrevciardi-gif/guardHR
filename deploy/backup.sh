#!/bin/sh
# Dumps the PostgreSQL database to $BACKUP_DIR (default ./backups), proves the archive can be read back, and deletes
# dumps older than $KEEP_DAYS (default 14). Run from cron on the host, e.g. daily:
#   23 2 * * * cd /srv/nemoguard && ./deploy/backup.sh >> backups/backup.log 2>&1
# Exit status is non-zero on any failure, so cron mail / your monitoring sees it. See docs/deployment.md (Backups).
set -eu
cd "$(dirname "$0")/.."

BACKUP_DIR=${BACKUP_DIR:-backups}
KEEP_DAYS=${KEEP_DAYS:-14}
COMPOSE=${COMPOSE:-docker compose -f docker-compose.yml -f docker-compose.prod.yml}

umask 077 # dumps hold candidate names, emails and answers: owner only
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/nemoguard-$(date -u +%Y%m%dT%H%M%SZ).dump"
trap 'rm -f "$file.partial"' EXIT # a half-written dump must never look like a backup

# $POSTGRES_USER / $POSTGRES_DB are read inside the container, where compose already set them.
$COMPOSE exec -T db sh -c 'pg_dump --format=custom --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$file.partial"
# Reading the table of contents back fails on a truncated or corrupt archive.
$COMPOSE exec -T db pg_restore --list < "$file.partial" > /dev/null
mv "$file.partial" "$file"

find "$BACKUP_DIR" -name 'nemoguard-*.dump' -mtime +"$KEEP_DAYS" -exec rm -f {} +
echo "backup ok: $file ($(wc -c < "$file") bytes)"
