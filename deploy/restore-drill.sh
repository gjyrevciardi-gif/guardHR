#!/bin/sh
# Restore drill: restores a backup into a scratch database, checks it holds data, shows it next to the live database and
# drops the scratch copy again. Proves the dumps from deploy/backup.sh can actually be restored, which a dump that merely
# reads back does not. The live database is only read. Run it once before relying on backups, then every few months:
#   ./deploy/restore-drill.sh                       # the newest dump in ./backups
#   ./deploy/restore-drill.sh backups/nemoguard-20260101T022300Z.dump
# Exit status is non-zero when there is no dump, the newest one is too old, the restore fails, or the copy is empty.
# See docs/deployment.md (Backups).
set -eu
cd "$(dirname "$0")/.."

BACKUP_DIR=${BACKUP_DIR:-backups}
MAX_AGE_HOURS=${MAX_AGE_HOURS:-36}
SCRATCH_DB=${SCRATCH_DB:-restore_check}
COMPOSE=${COMPOSE:-docker compose -f docker-compose.yml -f docker-compose.prod.yml}

if [ $# -ge 1 ]; then
  dump=$1
else
  dump=$(ls -t "$BACKUP_DIR"/nemoguard-*.dump 2>/dev/null | head -1 || true)
  # A newest dump that is days old means the nightly backup stopped, which is the thing worth finding out.
  if [ -n "$dump" ] && [ -n "$(find "$dump" -mmin +$((MAX_AGE_HOURS * 60)))" ]; then
    echo "the newest dump ($dump) is older than ${MAX_AGE_HOURS}h: backups have stopped" >&2
    exit 1
  fi
fi
if [ -z "$dump" ] || [ ! -s "$dump" ]; then
  echo "no dump to restore (looked for ${dump:-$BACKUP_DIR/nemoguard-*.dump})" >&2
  exit 1
fi

# The scratch name is passed in as $1 and compared with the live database inside the container, where it is known, before
# anything is dropped: a mistyped SCRATCH_DB must never be able to point at the real data.
drop_scratch() {
  $COMPOSE exec -T db sh -c '[ "$1" != "$POSTGRES_DB" ] || exit 1; dropdb --if-exists -U "$POSTGRES_USER" "$1"' sh "$SCRATCH_DB"
}
trap 'drop_scratch >/dev/null 2>&1 || true' EXIT

$COMPOSE exec -T db sh -c '[ "$1" != "$POSTGRES_DB" ] || { echo "refusing: $1 is the live database" >&2; exit 1; }; dropdb --if-exists -U "$POSTGRES_USER" "$1"; createdb -U "$POSTGRES_USER" "$1"' sh "$SCRATCH_DB"
echo "restoring $dump into $SCRATCH_DB"
$COMPOSE exec -T db sh -c 'pg_restore --no-owner --exit-on-error -U "$POSTGRES_USER" -d "$1"' sh "$SCRATCH_DB" < "$dump"

# users, the migration version and the three kinds of record that matter; the restored copy reflects the moment of the dump.
facts='select (select count(*) from users), (select count(*) from interview_sessions), (select count(*) from tests), (select version_num from alembic_version limit 1)'
restored=$($COMPOSE exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$1" -tAc "$2"' sh "$SCRATCH_DB" "$facts")
live=$($COMPOSE exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1"' sh "$facts")
echo "users|sessions|tests|migration"
echo "restored: $restored"
echo "live:     $live"

users=${restored%%|*}
version=${restored##*|}
if [ "${users:-0}" -lt 1 ] || [ -z "$version" ]; then
  echo "the restored copy has no users or no migration version: this backup is not usable" >&2
  exit 1
fi
echo "restore drill ok: $dump restored and holds data (compare the two rows above: the restored one can lag the live one by whatever changed since the dump)"
