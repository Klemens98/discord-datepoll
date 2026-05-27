import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { exchangeOAuthCode } from "./discord-auth.js";

export function createApp(deps) {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/discord/token", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const code = body.code;
    if (typeof code !== "string" || code.length === 0) {
      return c.json({ error: "missing_code" }, 400);
    }
    try {
      const tokens = await exchangeOAuthCode({
        code,
        clientId: deps.clientId,
        clientSecret: deps.clientSecret,
        fetchImpl: deps.fetchImpl
      });
      return c.json({
        access_token: tokens.access_token,
        expires_in: tokens.expires_in
      });
    } catch (error) {
      return c.json({ error: "exchange_failed", detail: String(error.message ?? error) }, 502);
    }
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return app;
}

export function startServer({ port, app }) {
  return serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
}
