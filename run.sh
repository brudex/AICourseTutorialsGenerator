#!/usr/bin/env bash
# post-receive sources this file from /bin/sh; re-enter Bash before Bash-only options.
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash /var/www/curriq.quizfactor/run.sh
fi
set -eo pipefail
echo "Starting AI Course Studio..."
PROJECT_FOLDER=/var/www/ai-course-studio
echo "Project folder: ${PROJECT_FOLDER}"
cd ${PROJECT_FOLDER}
echo "Building Docker image..."
docker compose build
echo "Starting Docker container..."
docker compose up -d --no-build
echo "Showing logs..."
docker compose logs --tail 100 api
echo "AI Course Studio started."
