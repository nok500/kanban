#!/bin/sh
# One-off migration of a stack deployed before the project's rename from
# "doska" to "kanban". It moves the data over to the new names that the compose
# files now use:
#
#   Postgres role + database   doska               -> kanban
#   named volumes              <p>_doska-pgdata    -> <p>_kanban-pgdata
#                              <p>_doska-files     -> <p>_kanban-files
#   bind-mounted folders       <dir>/doska-pgdata  -> <dir>/kanban-pgdata
#                              <dir>/doska-files   -> <dir>/kanban-files
#
# Data is copied, not moved: the old volumes and folders stay for rollback.
# Browser settings (`doska:*` localStorage keys) migrate themselves on the next
# page load.
#
#   scripts/migrate-from-doska.sh [-f compose-file] [-d db-service] [service...]
#
#   -f  compose file (default docker-compose.yml)
#   -d  the Postgres service (default db)
#   service...  the services to stop and start again (default: every service
#       in the file). Name the Kanban ones when the compose file also runs other
#       things, so only those are stopped.
#
# Update the compose file to the kanban names first: bind folders are found by
# looking for a `kanban-*` mount source whose `doska-*` sibling exists.
#
# Example, a stack shared with other apps:
#
#   scripts/migrate-from-doska.sh -f compose.yaml -d kanban-db \
#     kanban-db kanban-server kanban-web kanban-agent-runner kanban-probe
#
# The role's password is set to POSTGRES_PASSWORD (from the environment or
# .env), falling back to the compose default, "kanban".
set -eu

COMPOSE_FILE="docker-compose.yml"
DB="db"
while getopts f:d: opt; do
  case $opt in
    f) COMPOSE_FILE=$OPTARG ;;
    d) DB=$OPTARG ;;
    *) echo "usage: $0 [-f compose-file] [-d db-service] [service...]" >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
SERVICES="$*"

info() { printf '· %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

[ -f "$COMPOSE_FILE" ] || die "no $COMPOSE_FILE here"
command -v docker > /dev/null 2>&1 || die "docker is not installed"
COMPOSE="docker compose -f $COMPOSE_FILE"

# shellcheck disable=SC2086 # SERVICES is a word list on purpose
CONFIG=$($COMPOSE config $SERVICES 2> /dev/null) ||
  die "docker compose config failed for $COMPOSE_FILE${SERVICES:+ ($SERVICES)}"
# Only what this migration moves has to be renamed already: mount sources and
# the database settings. Other mentions (a transitional `doska-api` alias for
# an older web image, say) are left alone.
printf '%s\n' "$CONFIG" |
  grep -E '^ *(source|POSTGRES_USER|POSTGRES_DB|DATABASE_URL):.*doska' &&
  die "mounts or database settings above still say doska — update them to the kanban names first"
$COMPOSE config --services | grep -qx "$DB" ||
  die "no service named $DB (pick the Postgres one with -d)"

PROJECT=$(printf '%s\n' "$CONFIG" | sed -n 's/^name: *//p' | head -1)
[ -n "$PROJECT" ] || die "could not work out the compose project name"
info "compose project: $PROJECT${SERVICES:+, services: $SERVICES}"

PASSWORD=${POSTGRES_PASSWORD:-}
if [ -z "$PASSWORD" ] && [ -f .env ]; then
  PASSWORD=$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | tail -1)
fi
PASSWORD=${PASSWORD:-kanban}

has_volume() { docker volume inspect "$1" > /dev/null 2>&1; }

# --- 1. stop the services, keeping their data -------------------------------
info "stopping ${SERVICES:-the stack}"
# shellcheck disable=SC2086
$COMPOSE stop $SERVICES

# --- 2a. copy named volumes -------------------------------------------------
for name in pgdata files; do
  old="${PROJECT}_doska-$name"
  new="${PROJECT}_kanban-$name"
  has_volume "$old" || continue
  if has_volume "$new" &&
    [ -n "$(docker run --rm -v "$new:/to" alpine:3 ls -A /to)" ]; then
    info "$new already has data — skipping the copy"
    continue
  fi
  info "copying volume $old -> $new"
  docker volume create \
    --label "com.docker.compose.project=$PROJECT" \
    --label "com.docker.compose.volume=kanban-$name" \
    "$new" > /dev/null
  docker run --rm -v "$old:/from:ro" -v "$new:/to" alpine:3 \
    sh -c 'cp -a /from/. /to/'
done

# --- 2b. copy bind-mounted folders ------------------------------------------
# Bind sources show up in the resolved config as absolute paths. Postgres's
# folder belongs to the container's postgres user, so the copy runs in a
# container (as root there) rather than as whoever runs this script.
printf '%s\n' "$CONFIG" |
  sed -n 's#^ *source: *\(/.*/kanban-[^/]*\)$#\1#p' | sort -u |
  while IFS= read -r new; do
    parent=$(dirname "$new")
    base=$(basename "$new")
    old_base="doska-${base#kanban-}"
    [ -d "$parent/$old_base" ] || continue
    state=$(docker run --rm -v "$parent:/p" alpine:3 sh -c \
      "[ -n \"\$(ls -A '/p/$base' 2>/dev/null)\" ] && echo full || echo empty")
    if [ "$state" = full ]; then
      info "$new already has data — skipping the copy"
      continue
    fi
    info "copying folder $parent/$old_base -> $new"
    docker run --rm -v "$parent:/p" alpine:3 \
      sh -c "rm -rf '/p/$base' && cp -a '/p/$old_base' '/p/$base'"
  done

# --- 3. rename the role and database ----------------------------------------
info "starting $DB"
$COMPOSE up -d "$DB"
tries=0
# Asked as a role that exists, before or after the rename: a probe as a missing
# role still works but leaves a FATAL line in the database log.
until $COMPOSE exec -T "$DB" pg_isready -q -U doska > /dev/null 2>&1 ||
  $COMPOSE exec -T "$DB" pg_isready -q -U kanban > /dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || die "the database did not come up"
  sleep 1
done

# psql over the container's local socket, which the postgres image trusts.
psql_as() { $COMPOSE exec -T "$DB" psql -v ON_ERROR_STOP=1 -q -U "$1" -d postgres; }
role_exists() {
  [ "$($COMPOSE exec -T "$DB" psql -U "$2" -d postgres -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname = '$1'" 2> /dev/null)" = 1 ]
}

# doska first: before the rename it is the only role, so nothing logs a FATAL.
if ! role_exists doska doska; then
  role_exists kanban kanban || die "neither a kanban nor a doska role in the database"
  info "role kanban already exists — nothing to rename"
else
  info "renaming role and database doska -> kanban"
  # A session cannot rename the role it is logged in as, so a throwaway
  # superuser does the renames.
  echo "CREATE ROLE kanban_migrate SUPERUSER LOGIN;" | psql_as doska
  escaped=$(printf '%s' "$PASSWORD" | sed "s/'/''/g")
  psql_as kanban_migrate << SQL
ALTER DATABASE doska RENAME TO kanban;
ALTER ROLE doska RENAME TO kanban;
ALTER ROLE kanban PASSWORD '$escaped';
SQL
  echo "DROP ROLE kanban_migrate;" | psql_as kanban
fi

# --- 4. back up -------------------------------------------------------------
info "starting ${SERVICES:-the stack}"
# shellcheck disable=SC2086
$COMPOSE up -d $SERVICES

printf '\n✓ migrated. Once the app looks right, remove the old copies:\n'
for name in pgdata files; do
  has_volume "${PROJECT}_doska-$name" &&
    printf '    docker volume rm %s\n' "${PROJECT}_doska-$name"
done
printf '%s\n' "$CONFIG" |
  sed -n 's#^ *source: *\(/.*\)/kanban-\([^/]*\)$#\1/doska-\2#p' | sort -u |
  while IFS= read -r old; do
    [ -d "$old" ] && printf '    sudo rm -rf %s\n' "$old"
  done
exit 0
