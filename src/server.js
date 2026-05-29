import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { exchangeOAuthCode, getUserIdFromToken } from "./discord-auth.js";

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

  async function requireSession(c, next) {
    const auth = c.req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const accessToken = auth.slice("Bearer ".length).trim();
    const userId = await getUserIdFromToken({
      accessToken,
      cache: deps.tokenCache,
      fetchImpl: deps.fetchImpl
    });
    if (!userId) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const sessionToken = c.req.param("token");
    const session = deps.sessionsApi.getByToken(sessionToken);
    if (!session) {
      return c.json({ error: "session_expired" }, 410);
    }
    if (session.userId !== userId) {
      return c.json({ error: "forbidden" }, 403);
    }

    c.set("session", session);
    c.set("userId", userId);
    await next();
  }

  app.get("/api/sessions/current", async (c) => {
    const auth = c.req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const accessToken = auth.slice("Bearer ".length).trim();
    const userId = await getUserIdFromToken({
      accessToken,
      cache: deps.tokenCache,
      fetchImpl: deps.fetchImpl
    });
    if (!userId) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const channelId = c.req.query("channel_id") ?? null;
    const session = deps.sessionsApi.getForUser({ userId, channelId });
    if (!session) {
      return c.json({ error: "no_session" }, 404);
    }

    return c.json({
      token: session.token,
      title: session.title,
      selectedDates: [...session.selectedDates]
    });
  });

  app.get("/api/sessions/:token", requireSession, (c) => {
    const session = c.get("session");
    return c.json({
      title: session.title,
      selectedDates: [...session.selectedDates]
    });
  });

  app.post("/api/sessions/:token/toggle", requireSession, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const dateKey = body.dateKey;
    if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return c.json({ error: "missing_or_invalid_dateKey" }, 400);
    }
    const session = c.get("session");
    if (session.selectedDates.has(dateKey)) {
      session.selectedDates.delete(dateKey);
    } else {
      session.selectedDates.add(dateKey);
    }
    deps.sessionsApi.save();
    return c.json({ selectedDates: [...session.selectedDates] });
  });

  app.post("/api/sessions/:token/publish", requireSession, async (c) => {
    const session = c.get("session");
    try {
      const { channelId, messageId } = await deps.publishPoll(session);
      deps.sessionsApi.delete(session.id);
      return c.json({ ok: true, channelId, messageId });
    } catch (error) {
      if (error.code === 50001 || error.code === 50013) {
        return c.json({ error: "missing_permissions" }, 403);
      }
      return c.json({ error: "publish_failed", detail: String(error.message ?? error) }, 500);
    }
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return app;
}

export function startServer({ port, app }) {
  return serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
}
