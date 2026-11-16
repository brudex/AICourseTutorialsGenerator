#!/usr/bin/env bash

PROJECT_FOLDER=/var/www/curiq.quizfactor
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash /var/www/curiq.quizfactor/run.sh
fi
set -eo pipefail
echo "Starting AI Course Studio..."

echo "Project folder: ${PROJECT_FOLDER}"
cd ${PROJECT_FOLDER}
echo "Building Docker image..."
docker compose build
echo "Starting Docker container..."
docker compose up -d --no-build
echo "Showing logs..."
docker compose logs --tail 100 api
echo "AI Course Studio started."
