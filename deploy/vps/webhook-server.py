#!/usr/bin/env python3
"""Minimal GitHub webhook listener: deploy on push to main."""

from __future__ import annotations

import hashlib
import hmac
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

CONFIG_PATH = Path("/opt/discord-bot/config.env")
DEPLOY_SCRIPT = Path("/opt/discord-bot/scripts/deploy.sh")
LOG_PATH = Path("/opt/discord-bot/logs/webhook.log")


def load_config() -> dict[str, str]:
    values: dict[str, str] = {}
    if not CONFIG_PATH.exists():
        return values
    for line in CONFIG_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def log(message: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    timestamp = subprocess.check_output(["date", "-Iseconds"], text=True).strip()
    line = f"[{timestamp}] {message}\n"
    with LOG_PATH.open("a") as handle:
        handle.write(line)
    print(line, end="")


class WebhookHandler(BaseHTTPRequestHandler):
    config = load_config()
    secret = config.get("WEBHOOK_SECRET", "")
    branch = config.get("REPO_BRANCH", "main")

    def do_GET(self) -> None:
        if self.path in ("/", "/health"):
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok\n")
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path != "/webhook":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)

        if self.secret:
            signature = self.headers.get("X-Hub-Signature-256", "")
            expected = "sha256=" + hmac.new(
                self.secret.encode(), body, hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(signature, expected):
                log("Rejected webhook: invalid signature")
                self.send_error(401, "invalid signature")
                return

        event = self.headers.get("X-GitHub-Event", "")
        if event == "ping":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"pong\n")
            log("GitHub ping received")
            return

        if event != "push":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ignored\n")
            return

        payload = json.loads(body.decode())
        ref = payload.get("ref", "")
        expected_ref = f"refs/heads/{self.branch}"

        if ref != expected_ref:
            log(f"Ignored push to {ref} (watching {expected_ref})")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ignored branch\n")
            return

        log(f"Push to {self.branch} detected — starting deploy")
        subprocess.Popen(
            [str(DEPLOY_SCRIPT)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        self.send_response(202)
        self.end_headers()
        self.wfile.write(b"deploy started\n")

    def log_message(self, fmt: str, *args) -> None:
        log(f"{self.address_string()} - {fmt % args}")


def main() -> int:
    config = load_config()
    port = int(config.get("WEBHOOK_PORT", "9000"))
    if not config.get("WEBHOOK_SECRET"):
        log("WARNING: WEBHOOK_SECRET is empty — webhook is not authenticated")

    server = HTTPServer(("0.0.0.0", port), WebhookHandler)
    log(f"Listening on 0.0.0.0:{port} (/webhook, /health)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Shutting down")
        return 0


if __name__ == "__main__":
    sys.exit(main())
