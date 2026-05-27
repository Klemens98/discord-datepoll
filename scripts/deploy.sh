#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-user@datepoll.duckdns.org}"
SERVER_PATH="${SERVER_PATH:-/opt/datepoll}"
WEB_PATH="${WEB_PATH:-/var/www/datepoll/dist}"

echo "Building frontend..."
(cd web && npm run build)

echo "Uploading frontend bundle..."
rsync -r --delete web/dist/ "${SERVER}:${WEB_PATH}/"

echo "Pulling backend on server..."
ssh "${SERVER}" "cd ${SERVER_PATH} && git pull && npm install --omit=dev && sudo systemctl restart datepoll"

echo "Done."
