#!/bin/sh
# Apply pending migrations, then start whatever this container was asked to run
# (the web app by default, the worker when Compose overrides the command).
set -e
cd /app
echo "Applying database migrations..."
npx prisma migrate deploy
exec "$@"
