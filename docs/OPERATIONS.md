# DatePoll Operations

This guide covers first-time setup on a fresh Linux server (Debian/Ubuntu assumed).

## 1. Discord Developer Portal

1. Open <https://discord.com/developers/applications>.
2. Pick your DatePoll application.
3. **Activities**: Settings → Activities → Enable.
4. **Activity Shelf**: upload a 512×512 PNG icon, set title `DatePoll`, write a one-sentence description.
5. **URL Mappings**: add a single mapping with prefix `/` pointing at `datepoll.duckdns.org`.
6. **OAuth2 → General**: click `Reset Secret`, copy it. (This is `DISCORD_CLIENT_SECRET`.)
7. **Bot**: ensure the bot has `Send Messages`, `Embed Links`, `View Channels`. Re-invite if needed with scopes `bot applications.commands`.

## 2. DuckDNS

1. Sign in at <https://www.duckdns.org/> with GitHub or Google.
2. Reserve a subdomain (suggestion: `datepoll`).
3. Set the IP to your server's public IPv4.
4. Copy your DuckDNS token.
5. If the IP is dynamic, install the auto-updater:

   ```bash
   mkdir -p ~/.duckdns
   echo 'echo url="https://www.duckdns.org/update?domains=datepoll&token=YOUR_TOKEN&ip=" | curl -k -o ~/.duckdns/duck.log -K -' > ~/.duckdns/duck.sh
   chmod 700 ~/.duckdns/duck.sh
   (crontab -l 2>/dev/null; echo "*/5 * * * * ~/.duckdns/duck.sh >/dev/null 2>&1") | crontab -
   ```

## 3. Firewall

Open inbound TCP 80 (briefly for ACME challenges) and 443. On a typical UFW box:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

If the server is behind a home router, forward 80 and 443 to the server's LAN IP.

## 4. Install Node + Caddy + repo

```bash
# Node 20+ via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs caddy git

# Service user + dirs
sudo useradd -r -m -d /opt/datepoll datepoll
sudo mkdir -p /var/www/datepoll/dist
sudo chown -R datepoll:datepoll /var/www/datepoll /opt/datepoll

# Clone the repo
sudo -u datepoll git clone https://your-git-host/datepoll.git /opt/datepoll
cd /opt/datepoll
sudo -u datepoll npm install --omit=dev
```

## 5. Configure environment

```bash
sudo -u datepoll cp .env.example .env
sudo -u datepoll nano .env
```

Set: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `PUBLIC_URL=https://datepoll.duckdns.org`, `API_PORT=3000`, `AUTO_DEPLOY_COMMANDS=true`.

## 6. Caddy

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's|{$PUBLIC_HOST}|datepoll.duckdns.org|' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will fetch the Let's Encrypt cert on the first request.

## 7. systemd

```bash
sudo cp deploy/datepoll.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now datepoll
sudo journalctl -u datepoll -f
```

You should see `Logged in as <bot>` and `HTTP API listening on http://127.0.0.1:3000`.

## 8. First frontend build

On your dev machine:

```bash
SERVER=datepoll@datepoll.duckdns.org ./scripts/deploy.sh
```

This builds `web/dist` locally and rsyncs it to `/var/www/datepoll/dist`.

## 9. Smoke

Run `/datepoll title:Smoke Test` in your dev guild. Click the link button. The Activity panel should open with the calendar. Pick a date, click Publish. The public poll should appear in the channel.

## 10. Local development

Use a Cloudflare Tunnel during dev so Discord can reach your dev frontend:

```bash
cloudflared tunnel --url http://localhost:5173
```

Update the Activity's URL Mapping in the Developer Portal to the tunnel URL, then run:

```bash
cd web && npm run dev    # one terminal
npm start                # another terminal (bot + HTTP API)
```

Flip the URL Mapping back to `datepoll.duckdns.org` before deploying.
