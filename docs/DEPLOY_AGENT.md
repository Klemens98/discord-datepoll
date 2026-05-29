# DEPLOY_AGENT.md — Ship DatePoll to the Server

You are a Claude Code agent. This is your runbook for shipping DatePoll to a
fresh Linux server (Debian/Ubuntu) **or** rolling out an update to an existing
deploy. Treat every step as a gate: do not advance until the verification
passes. If a gate fails, stop and report — do not guess.

Source-of-truth references (read these once before starting):

- [INSTALLATION.md](INSTALLATION.md) — Discord app / bot config
- [OPERATIONS.md](OPERATIONS.md) — the human checklist this runbook automates
- [../deploy/Caddyfile](../deploy/Caddyfile) — reverse proxy
- [../deploy/datepoll.service](../deploy/datepoll.service) — systemd unit
- [../scripts/deploy.sh](../scripts/deploy.sh) — frontend rsync + backend pull

---

## 0. Mode selection

Ask the operator **exactly one** question before doing anything:

> "Is this a **first-time** server bootstrap or an **update** to an existing
> deploy?"

- `first-time` → run sections 1–9.
- `update` → run sections 8–9 only (skip to "Update path").

Then collect any missing inputs you do not already have:

| Input              | Example                          | Where to get it                          |
| ------------------ | -------------------------------- | ---------------------------------------- |
| `SERVER`           | `datepoll@datepoll.duckdns.org`  | Operator                                 |
| `SERVER_PATH`      | `/opt/datepoll`                  | Default in [deploy.sh](../scripts/deploy.sh) |
| `WEB_PATH`         | `/var/www/datepoll/dist`         | Default in [deploy.sh](../scripts/deploy.sh) |
| `PUBLIC_HOST`      | `datepoll.duckdns.org`           | DuckDNS                                  |
| `GIT_REMOTE`       | `https://…/datepoll.git`         | Operator                                 |

**Never** ask for `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`, or the DuckDNS
token. Those go straight from the operator into `.env` on the server. If they
ever appear in your context, stop and tell the operator to rotate them.

---

## 1. Discord Developer Portal

This is **operator-only** work. You cannot do it. Print this checklist and
wait for the operator to confirm each item:

- [ ] Application → Activities enabled
- [ ] URL Mapping: `/` → `${PUBLIC_HOST}`
- [ ] OAuth2 → Client Secret reset and copied
- [ ] Bot permissions: `Send Messages`, `Embed Links`, `View Channels`
- [ ] Bot invited with scopes `bot applications.commands`

**Gate:** operator types `confirmed` before continuing.

---

## 2. DNS + firewall (operator-driven, you verify)

Ask the operator to confirm DuckDNS is pointing at the server's public IPv4
and that TCP 80 + 443 are open (UFW or router port-forward).

**Verify** from your machine:

```bash
dig +short ${PUBLIC_HOST}
nc -zv ${PUBLIC_HOST} 443
```

**Gate:** DNS resolves to the expected IP; port 443 reachable (or refused —
not timed out). If timeouts, stop: firewall is wrong.

---

## 3. Install Node, Caddy, repo on the server

SSH in as the operator's sudo user and run:

```bash
ssh ${SERVER_SUDO_USER}@${PUBLIC_HOST} bash -s <<'EOF'
set -euo pipefail
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs caddy git rsync
sudo useradd -r -m -d /opt/datepoll datepoll || true
sudo mkdir -p /var/www/datepoll/dist
sudo chown -R datepoll:datepoll /var/www/datepoll /opt/datepoll
EOF
```

**Gate:** `node -v` ≥ 20, `caddy version` prints, both dirs exist and are
owned by `datepoll:datepoll`.

---

## 4. Clone repo + install deps

```bash
ssh ${SERVER_SUDO_USER}@${PUBLIC_HOST} bash -s <<EOF
set -euo pipefail
sudo -u datepoll git clone ${GIT_REMOTE} /opt/datepoll || \
  sudo -u datepoll git -C /opt/datepoll pull
cd /opt/datepoll && sudo -u datepoll npm install --omit=dev
EOF
```

**Gate:** `/opt/datepoll/package.json` present, `node_modules` populated.

---

## 5. Configure `.env` on the server

Do **not** scp a local `.env`. Have the operator paste secrets directly into
`/opt/datepoll/.env` on the server. Required keys (see
[../.env.example](../.env.example)):

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_GUILD_ID=
PUBLIC_URL=https://${PUBLIC_HOST}
API_PORT=3000
AUTO_DEPLOY_COMMANDS=true
```

**Gate:** run `sudo -u datepoll node /opt/datepoll/src/check-token.js`.
It must print a valid bot identity. If it fails, the token is wrong — stop.

---

## 6. Caddy

```bash
ssh ${SERVER_SUDO_USER}@${PUBLIC_HOST} bash -s <<EOF
set -euo pipefail
sudo cp /opt/datepoll/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's|{\$PUBLIC_HOST}|${PUBLIC_HOST}|' /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
EOF
```

**Gate:** `caddy validate` exits 0. `curl -sSI https://${PUBLIC_HOST}/`
returns HTTP/2 (may be 404 until first frontend build — that's fine, the
TLS handshake is what matters here).

---

## 7. systemd unit

```bash
ssh ${SERVER_SUDO_USER}@${PUBLIC_HOST} bash -s <<'EOF'
set -euo pipefail
sudo cp /opt/datepoll/deploy/datepoll.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now datepoll
EOF
```

**Gate:** `systemctl is-active datepoll` → `active`. `journalctl -u datepoll
-n 50 --no-pager` shows `Logged in as <bot>` **and** `HTTP API listening on
http://127.0.0.1:3000`. If either is missing, stop and surface the log.

---

## 8. Frontend build + rsync (this is the "update path" entry point)

Run **from the dev machine**, not the server:

```bash
SERVER=datepoll@${PUBLIC_HOST} ./scripts/deploy.sh
```

This builds `web/dist` locally, rsyncs it to `${WEB_PATH}`, pulls the backend
on the server, reinstalls prod deps, and restarts the service.

**Gates (run all three):**

1. `curl -sSI https://${PUBLIC_HOST}/` → `200` and `content-type: text/html`.
2. `curl -sS https://${PUBLIC_HOST}/api/health` (if present) or any
   `/api/*` endpoint → expected JSON.
3. `ssh ${SERVER} sudo journalctl -u datepoll -n 20 --no-pager` shows a clean
   restart, no crash loops.

If any gate fails, see § 10 (rollback).

---

## 9. Smoke test in Discord

Have the operator run in the configured guild:

```
/datepoll title:Smoke Test
```

Verify:

- [ ] Activity panel opens with the calendar
- [ ] Date select works
- [ ] Publish posts the poll to the channel
- [ ] Channel-id is in the Activity launch URL (regression guard for
      commit `1855119`)

**Gate:** operator confirms all four. Deploy is done.

---

## 10. Rollback

If § 8 gates fail:

```bash
ssh ${SERVER} bash -s <<'EOF'
set -euo pipefail
cd /opt/datepoll
PREV=$(git rev-parse HEAD@{1})
git reset --hard "$PREV"
npm install --omit=dev
sudo systemctl restart datepoll
EOF
```

Then re-rsync the **previous** `web/dist` if you have it locally, or rebuild
from the rolled-back commit:

```bash
git checkout "$PREV_LOCAL"
SERVER=datepoll@${PUBLIC_HOST} ./scripts/deploy.sh
```

Re-run § 8 gates. If still failing, stop and surface logs to the operator —
do not keep iterating blind.

---

## Non-negotiables

- Never run `git push --force`, `git reset --hard` on the dev machine, or
  `rm -rf` on the server without confirming the path with the operator.
- Never commit `.env`, tokens, or DuckDNS tokens to the repo.
- Never bypass a gate. A failed gate means "stop and report," not "retry
  with `--force`."
- Never invent missing inputs. Ask once, then wait.
