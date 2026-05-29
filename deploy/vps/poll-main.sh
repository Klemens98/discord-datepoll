#!/usr/bin/env bash
set -euo pipefail

CONFIG="/opt/discord-bot/config.env"
APP_DIR="/opt/discord-bot/app"
DEPLOY_SCRIPT="/opt/discord-bot/scripts/deploy.sh"
LOG="/opt/discord-bot/logs/poll.log"

source "${CONFIG}"
: "${REPO_URL:?Set REPO_URL in ${CONFIG}}"
: "${REPO_BRANCH:=main}"

log() {
  echo "[$(date -Iseconds)] $*" >> "${LOG}"
}

if [[ ! -d "${APP_DIR}/.git" ]]; then
  log "No clone yet — running full deploy"
  "${DEPLOY_SCRIPT}"
  exit 0
fi

git -C "${APP_DIR}" fetch origin "${REPO_BRANCH}" --quiet
LOCAL=$(git -C "${APP_DIR}" rev-parse HEAD)
REMOTE=$(git -C "${APP_DIR}" rev-parse "origin/${REPO_BRANCH}")

if [[ "${LOCAL}" != "${REMOTE}" ]]; then
  log "New commits on origin/${REPO_BRANCH} (${LOCAL:0:7} -> ${REMOTE:0:7}) — deploying"
  "${DEPLOY_SCRIPT}"
else
  log "Already up to date (${LOCAL:0:7})"
fi
