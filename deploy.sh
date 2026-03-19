#!/usr/bin/env sh
set -eu

APP_DIR="/var/www/crm-agente"
BRANCH="${DEPLOY_BRANCH:-master}"

cd "$APP_DIR"

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

docker compose up -d --build
docker image prune -f
