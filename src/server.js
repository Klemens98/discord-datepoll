import { Hono } from "hono";
import { serve } from "@hono/node-server";

export function createApp(deps) {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return app;
}

export function startServer({ port, app }) {
  return serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
}
