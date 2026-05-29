#!/usr/bin/env bash
set -euo pipefail

CONFIG="/opt/discord-bot/config.env"
APP_DIR="/opt/discord-bot/app"
WEB_DIR="/var/www/datepoll/dist"
LOG_DIR="/opt/discord-bot/logs"
DEPLOY_LOG="${LOG_DIR}/deploy.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "${DEPLOY_LOG}"
}

source "${CONFIG}"

: "${REPO_URL:?Set REPO_URL in ${CONFIG}}"
: "${REPO_BRANCH:=main}"
: "${INSTALL_COMMAND:=npm ci}"
: "${START_COMMAND:=npm start}"

mkdir -p "${LOG_DIR}" "${APP_DIR}" "${WEB_DIR}"
chown -R discordbot:discordbot /opt/discord-bot /var/www/datepoll 2>/dev/null || true

log "Deploy started (branch=${REPO_BRANCH})"

if [[ ! -d "${APP_DIR}/.git" ]]; then
  log "Cloning ${REPO_URL} into ${APP_DIR}"
  rm -rf "${APP_DIR:?}"/*
  git clone --branch "${REPO_BRANCH}" --single-branch "${REPO_URL}" "${APP_DIR}"
else
  log "Fetching latest ${REPO_BRANCH} from origin"
  git -C "${APP_DIR}" fetch origin "${REPO_BRANCH}"
  git -C "${APP_DIR}" reset --hard "origin/${REPO_BRANCH}"
  git -C "${APP_DIR}" clean -fd
fi

log "Installing backend dependencies: ${INSTALL_COMMAND}"
su -s /bin/bash discordbot -c "cd '${APP_DIR}' && ${INSTALL_COMMAND}" 2>&1 | tee -a "${DEPLOY_LOG}"

if [[ -d "${APP_DIR}/web" ]]; then
  log "Building frontend (web/)"
  su -s /bin/bash discordbot -c "cd '${APP_DIR}/web' && npm ci --legacy-peer-deps && npm run build" 2>&1 | tee -a "${DEPLOY_LOG}"
  log "Publishing frontend to ${WEB_DIR}"
  rsync -a --delete "${APP_DIR}/web/dist/" "${WEB_DIR}/"
  chown -R discordbot:discordbot "${WEB_DIR}"
fi

if [[ ! -f "${APP_DIR}/.env" && -f "${APP_DIR}/.env.example" ]]; then
  log "Creating .env from .env.example (fill in Discord tokens before bot can start)"
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  chown discordbot:discordbot "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
fi

log "Restarting discord-bot service"
systemctl restart discord-bot.service || true

if systemctl is-active --quiet discord-bot.service; then
  log "Deploy finished — bot is running"
else
  log "Deploy finished — bot not running yet (likely missing .env tokens; check: journalctl -u discord-bot -n 30)"
fi
