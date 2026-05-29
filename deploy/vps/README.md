# VPS auto-deploy stack

Pulls `main` on every GitHub push (webhook) or every 5 minutes (poll fallback).

## Layout on the server

```
/opt/discord-bot/
  config.env          # local — copy from config.env.example
  app/                # git clone of this repo (reset on deploy)
  scripts/            # copied from deploy/vps/ during bootstrap
  logs/
/var/www/datepoll/dist/   # built frontend
```

## Bootstrap

```bash
sudo mkdir -p /opt/discord-bot/{app,logs,scripts}
sudo useradd --system --home /opt/discord-bot --shell /usr/sbin/nologin discordbot || true
sudo cp deploy/vps/* /opt/discord-bot/scripts/
sudo cp deploy/vps/config.env.example /opt/discord-bot/config.env
sudo cp deploy/vps/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable discord-bot discord-bot-webhook discord-bot-poll.timer caddy
```

Fill in `/opt/discord-bot/config.env` and `/opt/discord-bot/app/.env`, then:

```bash
sudo /opt/discord-bot/scripts/deploy.sh
```

## GitHub webhook

- URL: `http://YOUR_VPS_IP:9000/webhook`
- Secret: `WEBHOOK_SECRET` from config.env
- Events: push
