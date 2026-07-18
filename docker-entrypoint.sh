#!/bin/sh
set -e

# Run database migrations (and seed the single user) before starting the server.
# Both are idempotent; safe to run on every container start.
if [ -d "./drizzle" ] && ls ./drizzle/*.sql >/dev/null 2>&1; then
  echo "[entrypoint] running migrations..."
  node ./node_modules/.bin/tsx ./src/db/migrate.ts
  echo "[entrypoint] seeding user..."
  node ./node_modules/.bin/tsx ./src/db/seed.ts
else
  echo "[entrypoint] no migrations found, skipping db setup"
fi

echo "[entrypoint] starting: $*"
exec "$@"
