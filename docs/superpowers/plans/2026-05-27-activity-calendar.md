# Discord Activity Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-chat dropdown setup view of `/datepoll` with a Discord Activity (React web app inside Discord's iframe panel) that lets users pick dates on a real visual calendar, then publishes the resulting poll to the channel using the existing voting view.

**Architecture:** Node bot keeps its Gateway connection and adds a Hono HTTP API on `127.0.0.1:3000`. A React+Vite frontend (in `web/`) runs inside Discord's Activity panel and talks to that HTTP API via Caddy (TLS termination + reverse proxy) on a DuckDNS subdomain. Sessions live in the existing on-disk JSON store with two new fields: a 32-byte capability `token` and a `lastActiveAt` timestamp.

**Tech Stack:** Node 24.15.0; discord.js 14.15.3 (existing); Hono 4.12.23 + @hono/node-server (new); React 18 + Vite 8.0.14 (new); react-day-picker 10.0.1 (new); @discord/embedded-app-sdk 2.5.0 (new); Caddy + DuckDNS + systemd (operational); `node --test` for bot; Vitest for frontend.

**Spec:** [docs/superpowers/specs/2026-05-27-activity-calendar-design.md](../specs/2026-05-27-activity-calendar-design.md)

---

## File Structure

**Modified:**

- `package.json` — bump scripts (`test`, `start`); add `hono`, `@hono/node-server` deps.
- `.env.example` — add `DISCORD_CLIENT_SECRET`, `PUBLIC_URL`, `API_PORT`.
- `.gitignore` — already excludes `node_modules/`, `.env`, `data/*.json`. Add `web/node_modules/` and `web/dist/`.
- `src/polls.js` — session shape gains `token`, `lastActiveAt`; add `getSetupSessionByToken`, `pruneExpiredSessions`; loader regenerates token if missing.
- `src/index.js` — `/datepoll` slash command emits a Link Button (no longer renders setup view); old `handleSetupInteraction`, `createSetupEmbed`, `updateSelectedDates` deleted; `handlePollInteraction` untouched. Boots the HTTP server alongside the gateway client.
- `src/components.js` — `setupCustomId`, `createSetupRows` deleted (no more in-chat setup); `pollCustomId`, `createPollRows`, `POLL_PREFIX`, `SETUP_PREFIX` preserved. (SETUP_PREFIX kept because the slash-command code still uses it as a constant for the now-Link-Button-only ephemeral.)

**Created (bot):**

- `src/server.js` — Hono HTTP API surface. Five routes; mounted on `127.0.0.1:3000` by default.
- `src/discord-auth.js` — OAuth code exchange + `/users/@me` token-to-userId cache.
- `src/voting.js` — extracted `createPollRows` (from `components.js`) and `createPollEmbed` (from `polls.js`).
- `src/polls.test.js` — token + TTL + pruner tests.
- `src/discord-auth.test.js` — auth helper unit tests.
- `src/server.test.js` — Hono route tests using `fetch` against an in-process server.

**Created (frontend):**

- `web/package.json`, `web/vite.config.js`, `web/index.html`, `web/.gitignore`.
- `web/src/main.jsx` — React entrypoint.
- `web/src/App.jsx` — top-level component.
- `web/src/api.js` — fetch helpers; centralized error handling.
- `web/src/discord/DiscordProvider.jsx` — SDK init, OAuth flow, context.
- `web/src/session/SessionLoader.jsx` — GET /api/sessions/:token; renders children when ready, error screens otherwise.
- `web/src/calendar/Calendar.jsx` — `react-day-picker` wrapper, multi-select, dispatches toggles to API.
- `web/src/calendar/Summary.jsx` — "X dates selected" line.
- `web/src/publish/PublishButton.jsx` — publish flow + success screen.
- `web/src/errors/ErrorScreens.jsx` — Expired, Forbidden, NetworkError, NotInDiscord.
- `web/src/styles.css` — CSS variables, light/dark, layout.
- `web/src/App.test.jsx`, `web/src/calendar/Calendar.test.jsx` — minimal Vitest coverage.

**Created (infra & docs):**

- `scripts/deploy.sh` — rsync build to server + restart service.
- `deploy/datepoll.service` — systemd unit file.
- `deploy/Caddyfile` — reference Caddyfile for `/etc/caddy/Caddyfile`.
- `docs/OPERATIONS.md` — manual setup checklist (DuckDNS, Caddy, systemd, Developer Portal).

---

## Task 1: Wire the test runner and add Hono dependency

**Files:**

- Modify: `package.json`
- Create: `src/sanity.test.js` (scratch, deleted in this task)

- [ ] **Step 1: Add `test` script and Hono deps to `package.json`**

In `package.json`, replace the `scripts` block:

```json
"scripts": {
  "start": "node src/index.js",
  "deploy": "node src/deploy-commands.js",
  "check-token": "node src/check-token.js"
}
```

with:

```json
"scripts": {
  "start": "node src/index.js",
  "deploy": "node src/deploy-commands.js",
  "check-token": "node src/check-token.js",
  "test": "node --test \"src/**/*.test.js\""
}
```

In the same file, replace the `dependencies` block:

```json
"dependencies": {
  "discord.js": "^14.15.3",
  "dotenv": "^16.4.5"
}
```

with:

```json
"dependencies": {
  "@hono/node-server": "^1.13.0",
  "discord.js": "^14.15.3",
  "dotenv": "^16.4.5",
  "hono": "^4.12.23"
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: lockfile updated; `node_modules/hono` present; no errors.

- [ ] **Step 3: Write a sanity test**

Create `src/sanity.test.js`:

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";

test("test runner is wired up", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 4: Run it**

Run: `npm test`
Expected: `pass 1, fail 0`.

- [ ] **Step 5: Smoke-check that Hono imports**

Run: `node -e "import('hono').then(m => console.log('Hono =', typeof m.Hono))"`
Expected output: `Hono = function`

- [ ] **Step 6: Delete the sanity test**

Delete `src/sanity.test.js`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "chore: add node --test runner and Hono dependency"
```

---

## Task 2: Session model — `token` + `lastActiveAt` + pruner

**Files:**

- Modify: `src/polls.js`
- Create: `src/polls.test.js`

The session in memory gains two fields: a 32-byte base64url `token` (capability identifier used by the HTTP API) and a `lastActiveAt` epoch-ms timestamp. A new `getSetupSessionByToken(token)` lookup is added. TTL logic deletes sessions older than `SESSION_TTL_MS` (1 hour) on access, plus a periodic `pruneExpiredSessions()` sweep.

- [ ] **Step 1: Write the failing tests**

Create `src/polls.test.js`:

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  createSetupSession,
  deleteSetupSession,
  getSetupSession,
  getSetupSessionByToken,
  pruneExpiredSessions,
  SESSION_TTL_MS
} from "./polls.js";

test("createSetupSession assigns a unique 32-byte base64url token", () => {
  const a = createSetupSession({ userId: "u1", channelId: "c1", title: "A" });
  const b = createSetupSession({ userId: "u1", channelId: "c1", title: "B" });
  assert.match(a.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(a.token, b.token);
  deleteSetupSession(a.id);
  deleteSetupSession(b.id);
});

test("createSetupSession initializes lastActiveAt to now", () => {
  const before = Date.now();
  const s = createSetupSession({ userId: "u1", channelId: "c1", title: "T" });
  const after = Date.now();
  assert.ok(s.lastActiveAt >= before && s.lastActiveAt <= after);
  deleteSetupSession(s.id);
});

test("getSetupSession refreshes lastActiveAt", () => {
  const s = createSetupSession({ userId: "u1", channelId: "c1", title: "T" });
  const halfTtlAgo = Date.now() - Math.floor(SESSION_TTL_MS / 2);
  s.lastActiveAt = halfTtlAgo;
  const fetched = getSetupSession(s.id);
  assert.equal(fetched, s);
  assert.ok(s.lastActiveAt > halfTtlAgo);
  deleteSetupSession(s.id);
});

test("getSetupSession returns undefined for expired sessions", () => {
  const s = createSetupSession({ userId: "u1", channelId: "c1", title: "T" });
  s.lastActiveAt = Date.now() - SESSION_TTL_MS - 1;
  assert.equal(getSetupSession(s.id), undefined);
});

test("getSetupSessionByToken finds the session by its token", () => {
  const s = createSetupSession({ userId: "u1", channelId: "c1", title: "T" });
  const found = getSetupSessionByToken(s.token);
  assert.equal(found, s);
  deleteSetupSession(s.id);
});

test("getSetupSessionByToken returns undefined for unknown tokens", () => {
  assert.equal(getSetupSessionByToken("not-a-real-token"), undefined);
});

test("pruneExpiredSessions removes only expired entries", () => {
  const fresh = createSetupSession({ userId: "u1", channelId: "c1", title: "fresh" });
  const stale = createSetupSession({ userId: "u1", channelId: "c1", title: "stale" });
  stale.lastActiveAt = Date.now() - SESSION_TTL_MS - 1;

  pruneExpiredSessions();

  assert.equal(getSetupSession(fresh.id), fresh);
  assert.equal(getSetupSession(stale.id), undefined);
  deleteSetupSession(fresh.id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 7 new failures — exports like `getSetupSessionByToken`, `pruneExpiredSessions`, `SESSION_TTL_MS` don't exist; `token` and `lastActiveAt` aren't set.

- [ ] **Step 3: Update `src/polls.js`**

In `src/polls.js`, change the imports at the top from:

```javascript
import { EmbedBuilder } from "discord.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dateLabel } from "./date-utils.js";
```

to:

```javascript
import { EmbedBuilder } from "discord.js";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dateLabel } from "./date-utils.js";
```

Below the existing module constants (after `const SESSIONS_FILE = ...`), add:

```javascript
export const SESSION_TTL_MS = 60 * 60 * 1000;

function generateSessionToken() {
  return randomBytes(32).toString("base64url");
}
```

Replace the `createSetupSession` function body. Current:

```javascript
export function createSetupSession({ userId, channelId, title }) {
  const id = crypto.randomUUID();
  const startMonth = new Date();
  startMonth.setDate(1);
  startMonth.setHours(0, 0, 0, 0);

  const session = {
    id,
    userId,
    channelId,
    title,
    startMonth,
    visibleMonth: new Date(startMonth),
    monthOffset: 0,
    dayPage: 0,
    selectedDates: new Set()
  };

  sessions.set(id, session);
  saveSessions();
  return session;
}
```

Replace with:

```javascript
export function createSetupSession({ userId, channelId, title }) {
  const session = {
    id: crypto.randomUUID(),
    token: generateSessionToken(),
    userId,
    channelId,
    title,
    selectedDates: new Set(),
    lastActiveAt: Date.now()
  };

  sessions.set(session.id, session);
  saveSessions();
  return session;
}
```

Replace the `getSetupSession` function. Current:

```javascript
export function getSetupSession(id) {
  return sessions.get(id);
}
```

Replace with:

```javascript
export function getSetupSession(id) {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (Date.now() - session.lastActiveAt > SESSION_TTL_MS) {
    sessions.delete(id);
    saveSessions();
    return undefined;
  }
  session.lastActiveAt = Date.now();
  return session;
}

export function getSetupSessionByToken(token) {
  for (const session of sessions.values()) {
    if (session.token === token) {
      return getSetupSession(session.id);
    }
  }
  return undefined;
}

export function pruneExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  let removed = 0;
  for (const [id, session] of sessions) {
    if (session.lastActiveAt < cutoff) {
      sessions.delete(id);
      removed += 1;
    }
  }
  if (removed > 0) saveSessions();
  return removed;
}
```

Replace the `loadSessions` function. Current:

```javascript
function loadSessions() {
  if (!existsSync(SESSIONS_FILE)) {
    return;
  }

  const savedSessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));

  for (const savedSession of savedSessions) {
    sessions.set(savedSession.id, {
      ...savedSession,
      startMonth: new Date(savedSession.startMonth),
      visibleMonth: new Date(savedSession.visibleMonth),
      dayPage: savedSession.dayPage ?? 0,
      selectedDates: new Set(savedSession.selectedDates)
    });
  }
}
```

Replace with:

```javascript
function loadSessions() {
  if (!existsSync(SESSIONS_FILE)) {
    return;
  }

  const savedSessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
  const now = Date.now();

  for (const savedSession of savedSessions) {
    sessions.set(savedSession.id, {
      id: savedSession.id,
      token: savedSession.token ?? generateSessionToken(),
      userId: savedSession.userId,
      channelId: savedSession.channelId,
      title: savedSession.title,
      selectedDates: new Set(savedSession.selectedDates),
      lastActiveAt: savedSession.lastActiveAt ?? now
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: `pass 7, fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/polls.js src/polls.test.js
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(polls): session token, TTL, pruner"
```

---

## Task 3: Discord auth helper (`src/discord-auth.js`)

**Files:**

- Create: `src/discord-auth.js`
- Create: `src/discord-auth.test.js`

Server-side helper that (a) exchanges an OAuth code for an access token via Discord's REST API, and (b) resolves an access token → Discord user ID via `/users/@me`, cached for 10 minutes to avoid hammering Discord.

- [ ] **Step 1: Write the failing tests**

Create `src/discord-auth.test.js`:

```javascript
import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

test("exchangeOAuthCode POSTs to /api/v10/oauth2/token with correct form body", async () => {
  const calls = [];
  const fakeFetch = mock.fn(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });
  const { exchangeOAuthCode } = await import("./discord-auth.js");
  const result = await exchangeOAuthCode({
    code: "C0DE",
    clientId: "id",
    clientSecret: "secret",
    fetchImpl: fakeFetch
  });
  assert.equal(result.access_token, "tok");
  assert.equal(result.expires_in, 3600);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://discord.com/api/v10/oauth2/token");
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.body instanceof URLSearchParams);
  assert.equal(calls[0].init.body.get("grant_type"), "authorization_code");
  assert.equal(calls[0].init.body.get("code"), "C0DE");
});

test("exchangeOAuthCode throws when Discord returns non-2xx", async () => {
  const fakeFetch = mock.fn(async () => new Response("nope", { status: 400 }));
  const { exchangeOAuthCode } = await import("./discord-auth.js");
  await assert.rejects(
    () => exchangeOAuthCode({ code: "x", clientId: "id", clientSecret: "s", fetchImpl: fakeFetch }),
    /Discord token exchange failed/
  );
});

test("getUserIdFromToken caches /users/@me responses", async () => {
  let calls = 0;
  const fakeFetch = mock.fn(async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: "9001" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });
  const { createTokenCache, getUserIdFromToken } = await import("./discord-auth.js");
  const cache = createTokenCache();
  const first = await getUserIdFromToken({ accessToken: "tok", cache, fetchImpl: fakeFetch });
  const second = await getUserIdFromToken({ accessToken: "tok", cache, fetchImpl: fakeFetch });
  assert.equal(first, "9001");
  assert.equal(second, "9001");
  assert.equal(calls, 1);
});

test("getUserIdFromToken returns null on 401", async () => {
  const fakeFetch = mock.fn(async () => new Response("", { status: 401 }));
  const { createTokenCache, getUserIdFromToken } = await import("./discord-auth.js");
  const cache = createTokenCache();
  const result = await getUserIdFromToken({ accessToken: "bad", cache, fetchImpl: fakeFetch });
  assert.equal(result, null);
});

test("getUserIdFromToken expires cached entries after the TTL", async () => {
  let calls = 0;
  const fakeFetch = mock.fn(async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: "9001" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });
  const { createTokenCache, getUserIdFromToken, TOKEN_CACHE_TTL_MS } = await import("./discord-auth.js");
  const cache = createTokenCache();
  await getUserIdFromToken({ accessToken: "tok", cache, fetchImpl: fakeFetch });
  cache.set("tok", { userId: "9001", cachedAt: Date.now() - TOKEN_CACHE_TTL_MS - 1 });
  await getUserIdFromToken({ accessToken: "tok", cache, fetchImpl: fakeFetch });
  assert.equal(calls, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 5 new failures with `discord-auth.js` import error.

- [ ] **Step 3: Implement `src/discord-auth.js`**

Create `src/discord-auth.js`:

```javascript
export const TOKEN_CACHE_TTL_MS = 10 * 60 * 1000;

export function createTokenCache() {
  return new Map();
}

export async function exchangeOAuthCode({ code, clientId, clientSecret, fetchImpl = fetch }) {
  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("grant_type", "authorization_code");
  body.set("code", code);

  const response = await fetchImpl("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Discord token exchange failed (${response.status}): ${detail}`);
  }

  return response.json();
}

export async function getUserIdFromToken({ accessToken, cache, fetchImpl = fetch }) {
  const cached = cache.get(accessToken);
  if (cached && Date.now() - cached.cachedAt < TOKEN_CACHE_TTL_MS) {
    return cached.userId;
  }

  const response = await fetchImpl("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Discord /users/@me failed (${response.status})`);
  }

  const { id } = await response.json();
  cache.set(accessToken, { userId: id, cachedAt: Date.now() });
  return id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all `discord-auth` tests pass. `pass 12, fail 0` cumulative.

- [ ] **Step 5: Commit**

```bash
git add src/discord-auth.js src/discord-auth.test.js
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(auth): Discord OAuth code exchange and /users/@me cache"
```

---

## Task 4: Hono HTTP server scaffold (`src/server.js`)

**Files:**

- Create: `src/server.js`
- Create: `src/server.test.js`

Sets up the Hono app and mounts the no-auth `/api/health` endpoint. Exposes a `createApp(deps)` factory and a `startServer({ port, app })` function so tests can construct an app with fake deps and hit it via `app.fetch(...)` without a real socket.

- [ ] **Step 1: Write the failing test**

Create `src/server.test.js`:

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createApp } from "./server.js";

function fakeDeps(overrides = {}) {
  return {
    clientId: "stub-client",
    clientSecret: "stub-secret",
    tokenCache: new Map(),
    fetchImpl: async () => new Response(""),
    sessionsApi: { getByToken: () => undefined, save: () => {}, delete: () => {} },
    publishPoll: async () => ({ channelId: "x", messageId: "y" }),
    ...overrides
  };
}

test("GET /api/health returns ok", async () => {
  const app = createApp(fakeDeps());
  const res = await app.fetch(new Request("http://test/api/health"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: new failure with `Cannot find module './server.js'`.

- [ ] **Step 3: Implement `src/server.js`**

Create `src/server.js`:

```javascript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: `pass 13, fail 0` cumulative.

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/server.test.js
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(server): Hono app scaffold with /api/health"
```

---

## Task 5: `POST /api/discord/token` route

**Files:**

- Modify: `src/server.js`, `src/server.test.js`

Wraps `exchangeOAuthCode` from the auth helper. Takes `{ code }`, returns `{ access_token, expires_in }`. Returns 400 on missing code, 502 on upstream failure.

- [ ] **Step 1: Write the failing tests**

Append to `src/server.test.js`:

```javascript
import { mock } from "node:test";

test("POST /api/discord/token exchanges code with Discord and returns access token", async () => {
  const fakeFetch = mock.fn(async (url) => {
    if (url === "https://discord.com/api/v10/oauth2/token") {
      return new Response(JSON.stringify({ access_token: "tok-abc", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error("unexpected fetch: " + url);
  });
  const app = createApp(fakeDeps({ fetchImpl: fakeFetch }));
  const res = await app.fetch(new Request("http://test/api/discord/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "CODE123" })
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.access_token, "tok-abc");
  assert.equal(body.expires_in, 3600);
});

test("POST /api/discord/token rejects missing code", async () => {
  const app = createApp(fakeDeps());
  const res = await app.fetch(new Request("http://test/api/discord/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  }));
  assert.equal(res.status, 400);
});

test("POST /api/discord/token returns 502 when Discord rejects the exchange", async () => {
  const fakeFetch = mock.fn(async () => new Response("nope", { status: 400 }));
  const app = createApp(fakeDeps({ fetchImpl: fakeFetch }));
  const res = await app.fetch(new Request("http://test/api/discord/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "bad" })
  }));
  assert.equal(res.status, 502);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 3 new failures (the route doesn't exist).

- [ ] **Step 3: Implement the route**

In `src/server.js`, at the top of the file change the import line:

```javascript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
```

to:

```javascript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { exchangeOAuthCode } from "./discord-auth.js";
```

Inside `createApp`, immediately after the `/api/health` registration, add:

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: `pass 16, fail 0` cumulative.

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/server.test.js
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(server): POST /api/discord/token route"
```

---

## Task 6: Auth middleware + `GET /api/sessions/:token`

**Files:**

- Modify: `src/server.js`, `src/server.test.js`

Adds an authentication middleware for `/api/sessions/*` routes that (a) parses the `Authorization: Bearer <token>` header, (b) resolves to a Discord user via `getUserIdFromToken`, (c) looks up the session by capability token, (d) verifies ownership, and stashes `{ userId, session }` on the context. Then implements `GET /api/sessions/:token` returning `{ title, selectedDates }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/server.test.js`:

```javascript
function makeAuthedFetch({ sessionsApi, getUserIdImpl }) {
  return fakeDeps({
    sessionsApi,
    fetchImpl: async (url, init) => {
      if (url === "https://discord.com/api/v10/users/@me") {
        const auth = init?.headers?.Authorization ?? init?.headers?.authorization;
        return getUserIdImpl(auth);
      }
      throw new Error("unexpected fetch: " + url);
    }
  });
}

test("GET /api/sessions/:token requires Authorization header", async () => {
  const app = createApp(fakeDeps());
  const res = await app.fetch(new Request("http://test/api/sessions/some-token"));
  assert.equal(res.status, 401);
});

test("GET /api/sessions/:token returns 410 when session expired/missing", async () => {
  const app = createApp(makeAuthedFetch({
    sessionsApi: { getByToken: () => undefined, save: () => {}, delete: () => {} },
    getUserIdImpl: () => new Response(JSON.stringify({ id: "user-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }));
  const res = await app.fetch(new Request("http://test/api/sessions/dead-token", {
    headers: { Authorization: "Bearer t" }
  }));
  assert.equal(res.status, 410);
});

test("GET /api/sessions/:token returns 403 when Discord user is not the owner", async () => {
  const session = {
    id: "s1", token: "tok", userId: "owner-1", channelId: "c", title: "T",
    selectedDates: new Set(["2026-06-01"]), lastActiveAt: Date.now()
  };
  const app = createApp(makeAuthedFetch({
    sessionsApi: { getByToken: (t) => t === "tok" ? session : undefined, save: () => {}, delete: () => {} },
    getUserIdImpl: () => new Response(JSON.stringify({ id: "intruder" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }));
  const res = await app.fetch(new Request("http://test/api/sessions/tok", {
    headers: { Authorization: "Bearer t" }
  }));
  assert.equal(res.status, 403);
});

test("GET /api/sessions/:token returns title and selectedDates for the owner", async () => {
  const session = {
    id: "s1", token: "tok", userId: "owner-1", channelId: "c", title: "Movie Night",
    selectedDates: new Set(["2026-06-01", "2026-06-02"]), lastActiveAt: Date.now()
  };
  const app = createApp(makeAuthedFetch({
    sessionsApi: { getByToken: (t) => t === "tok" ? session : undefined, save: () => {}, delete: () => {} },
    getUserIdImpl: () => new Response(JSON.stringify({ id: "owner-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }));
  const res = await app.fetch(new Request("http://test/api/sessions/tok", {
    headers: { Authorization: "Bearer t" }
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.title, "Movie Night");
  assert.deepEqual(body.selectedDates.sort(), ["2026-06-01", "2026-06-02"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 4 new failures (route doesn't exist; middleware doesn't exist).

- [ ] **Step 3: Implement middleware + route**

In `src/server.js`, change the imports at the top from:

```javascript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { exchangeOAuthCode } from "./discord-auth.js";
```

to:

```javascript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { exchangeOAuthCode, getUserIdFromToken } from "./discord-auth.js";
```

Inside `createApp`, after the `/api/discord/token` registration, add:

```javascript
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

  app.get("/api/sessions/:token", requireSession, (c) => {
    const session = c.get("session");
    return c.json({
      title: session.title,
      selectedDates: [...session.selectedDates]
    });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: `pass 20, fail 0` cumulative.

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/server.test.js
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(server): auth middleware + GET /api/sessions/:token"
```

---

## Task 7: `POST /api/sessions/:token/toggle`

**Files:**

- Modify: `src/server.js`, `src/server.test.js`

Reuses the auth middleware. Body: `{ dateKey: string }`. Toggles XOR in `session.selectedDates`. Returns `{ selectedDates }`. Calls `sessionsApi.save()` to persist.

- [ ] **Step 1: Write the failing tests**

Append to `src/server.test.js`:

```javascript
test("POST /api/sessions/:token/toggle adds a missing date", async () => {
  const saved = [];
  const session = {
    id: "s1", token: "tok", userId: "owner-1", channelId: "c", title: "T",
    selectedDates: new Set(), lastActiveAt: Date.now()
  };
  const app = createApp(makeAuthedFetch({
    sessionsApi: {
      getByToken: () => session,
      save: () => saved.push("save"),
      delete: () => {}
    },
    getUserIdImpl: () => new Response(JSON.stringify({ id: "owner-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }));
  const res = await app.fetch(new Request("http://test/api/sessions/tok/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify({ dateKey: "2026-06-15" })
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.selectedDates, ["2026-06-15"]);
  assert.ok(session.selectedDates.has("2026-06-15"));
  assert.equal(saved.length, 1);
});

test("POST /api/sessions/:token/toggle removes a previously-selected date", async () => {
  const session = {
    id: "s1", token: "tok", userId: "owner-1", channelId: "c", title: "T",
    selectedDates: new Set(["2026-06-15"]), lastActiveAt: Date.now()
  };
  const app = createApp(makeAuthedFetch({
    sessionsApi: { getByToken: () => session, save: () => {}, delete: () => {} },
    getUserIdImpl: () => new Response(JSON.stringify({ id: "owner-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }));
  const res = await app.fetch(new Request("http://test/api/sessions/tok/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify({ dateKey: "2026-06-15" })
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.selectedDates, []);
  assert.ok(!session.selectedDates.has("2026-06-15"));
});

test("POST /api/sessions/:token/toggle rejects missing dateKey", async () => {
  const session = {
    id: "s1", token: "tok", userId: "owner-1", channelId: "c", title: "T",
    selectedDates: new Set(), lastActiveAt: Date.now()
  };
  const app = createApp(makeAuthedFetch({
    sessionsApi: { getByToken: () => session, save: () => {}, delete: () => {} },
    getUserIdImpl: () => new Response(JSON.stringify({ id: "owner-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }));
  const res = await app.fetch(new Request("http://test/api/sessions/tok/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify({})
  }));
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 3 new failures.

- [ ] **Step 3: Implement the route**

In `src/server.js`, after the `GET /api/sessions/:token` registration, add:

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: `pass 23, fail 0` cumulative.

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/server.test.js
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(server): POST /api/sessions/:token/toggle"
```

---

## Task 8: `POST /api/sessions/:token/publish`

**Files:**

- Modify: `src/server.js`, `src/server.test.js`

Calls `deps.publishPoll(session)` (which encapsulates the gateway-side poll posting). On success deletes the session and returns `{ ok: true, channelId, messageId }`. On 50001/50013 returns 403 with `error: "missing_permissions"`.

- [ ] **Step 1: Write the failing tests**

Append to `src/server.test.js`:

```javascript
test("POST /api/sessions/:token/publish posts the poll and deletes the session", async () => {
  const session = {
    id: "s1", token: "tok", userId: "owner-1", channelId: "C",
    title: "T", selectedDates: new Set(["2026-06-01"]), lastActiveAt: Date.now()
  };
  const deleted = [];
  const app = createApp(makeAuthedFetch({
    sessionsApi: {
      getByToken: () => session,
      save: () => {},
      delete: (id) => deleted.push(id)
    },
    getUserIdImpl: () => new Response(JSON.stringify({ id: "owner-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }));
  const deps = app.fakeDepsForTest ?? null;
  // The real publishPoll is injected via deps; verify by overriding through closure:
  // We instead use a separate factory call:
  const finalApp = createApp({
    ...fakeDeps(),
    sessionsApi: {
      getByToken: () => session,
      save: () => {},
      delete: (id) => deleted.push(id)
    },
    fetchImpl: async (url) => {
      if (url === "https://discord.com/api/v10/users/@me") {
        return new Response(JSON.stringify({ id: "owner-1" }), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error("unexpected fetch: " + url);
    },
    publishPoll: async (s) => {
      assert.equal(s, session);
      return { channelId: "C", messageId: "M" };
    }
  });
  const res = await finalApp.fetch(new Request("http://test/api/sessions/tok/publish", {
    method: "POST",
    headers: { Authorization: "Bearer t" }
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, channelId: "C", messageId: "M" });
  assert.deepEqual(deleted, ["s1"]);
});

test("POST /api/sessions/:token/publish returns 403 missing_permissions on 50001/50013", async () => {
  const session = {
    id: "s1", token: "tok", userId: "owner-1", channelId: "C",
    title: "T", selectedDates: new Set(["2026-06-01"]), lastActiveAt: Date.now()
  };
  const app = createApp({
    ...fakeDeps(),
    sessionsApi: { getByToken: () => session, save: () => {}, delete: () => {} },
    fetchImpl: async () => new Response(JSON.stringify({ id: "owner-1" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    }),
    publishPoll: async () => {
      const e = new Error("permission");
      e.code = 50013;
      throw e;
    }
  });
  const res = await app.fetch(new Request("http://test/api/sessions/tok/publish", {
    method: "POST",
    headers: { Authorization: "Bearer t" }
  }));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "missing_permissions");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 2 new failures.

- [ ] **Step 3: Implement the route**

In `src/server.js`, after the `/toggle` registration, add:

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: `pass 25, fail 0` cumulative.

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/server.test.js
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(server): POST /api/sessions/:token/publish"
```

---

## Task 9: Extract voting view to `src/voting.js`

**Files:**

- Create: `src/voting.js`
- Modify: `src/components.js`, `src/polls.js`

Pulls `createPollRows` out of `components.js` and `createPollEmbed` out of `polls.js` into a focused module. `components.js` keeps only `POLL_PREFIX`, `SETUP_PREFIX`, `pollCustomId` (used by `createPollRows`'s custom IDs). The old `setupCustomId`/`createSetupRows` are deleted — the Activity replaces them.

- [ ] **Step 1: Create `src/voting.js`**

Create `src/voting.js`:

```javascript
import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import { pollCustomId } from "./components.js";
import { dateLabel } from "./date-utils.js";

export function createPollRows(poll) {
  const sortedDates = [...poll.dates].sort();
  const chunks = [];

  for (let i = 0; i < sortedDates.length; i += 25) {
    chunks.push(sortedDates.slice(i, i + 25));
  }

  return chunks.map((chunk, index) =>
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(pollCustomId(poll.id, index))
        .setPlaceholder(index === 0 ? "Choose your dates" : "Choose more dates")
        .setMinValues(0)
        .setMaxValues(chunk.length)
        .addOptions(
          chunk.map((key) => ({
            label: dateLabel(key),
            value: key
          }))
        )
    )
  );
}

export function createPollEmbed(poll) {
  const counts = new Map(poll.dates.map((key) => [key, 0]));

  for (const selectedDates of poll.votes.values()) {
    for (const key of selectedDates) {
      if (counts.has(key)) {
        counts.set(key, counts.get(key) + 1);
      }
    }
  }

  const lines = poll.dates.map((key) => {
    const voters = [...poll.votes.entries()]
      .filter(([, selectedDates]) => selectedDates.has(key))
      .map(([userId]) => `<@${userId}>`);
    const voterText = voters.length > 0 ? ` - ${voters.join(", ")}` : "";
    return `**${dateLabel(key)}**: ${counts.get(key)}${voterText}`;
  });

  return new EmbedBuilder()
    .setTitle(poll.title)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Select every date that works for you." })
    .setColor(0x2f855a);
}
```

- [ ] **Step 2: Trim `src/components.js`**

Replace the entire contents of `src/components.js` with:

```javascript
export const POLL_PREFIX = "datepoll";
export const SETUP_PREFIX = "datesetup";

export function pollCustomId(pollId, chunkIndex) {
  return `${POLL_PREFIX}:${pollId}:${chunkIndex}`;
}
```

- [ ] **Step 3: Remove `createPollEmbed` from `src/polls.js`**

In `src/polls.js`, remove the entire `createPollEmbed` function (it now lives in `voting.js`). Remove its import of `EmbedBuilder` if it becomes unused, and the `dateLabel` import if no other code in `polls.js` uses it (`serializePoll` does — keep `dateLabel`).

Specifically, `polls.js` should NOT import `EmbedBuilder` any longer. Remove this line if present:

```javascript
import { EmbedBuilder } from "discord.js";
```

- [ ] **Step 4: Run tests to verify nothing regressed**

Run: `npm test`
Expected: `pass 25, fail 0` (no new tests; the existing suite still passes).

- [ ] **Step 5: Verify imports compile**

Run: `node --check src/voting.js && node --check src/components.js && node --check src/polls.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/voting.js src/components.js src/polls.js
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "refactor: extract voting view to src/voting.js"
```

---

## Task 10: Rewrite slash command to emit the Activity Link Button

**Files:**

- Modify: `src/index.js`

The slash command no longer renders the setup view. It creates a session and posts an ephemeral message with a single Link Button whose URL launches the Activity. The setup interaction handler is deleted; the poll voting handler is preserved.

- [ ] **Step 1: Update imports in `src/index.js`**

Replace the existing top-of-file imports:

```javascript
import "dotenv/config";
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  InteractionType,
  MessageFlags
} from "discord.js";
import { createPollRows, createSetupRows, POLL_PREFIX, SETUP_PREFIX } from "./components.js";
import { registerCommands } from "./commands.js";
import { addMonths, getMonthDays, monthLabel, renderCalendar } from "./date-utils.js";
import {
  createPoll,
  createPollEmbed,
  createSetupSession,
  deleteSetupSession,
  getPoll,
  getSetupSession,
  saveSetupSessions,
  setPollMessageTarget,
  setVotes
} from "./polls.js";
```

with:

```javascript
import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  InteractionType,
  MessageFlags
} from "discord.js";
import { POLL_PREFIX } from "./components.js";
import { registerCommands } from "./commands.js";
import { createPollEmbed, createPollRows } from "./voting.js";
import {
  createPoll,
  createSetupSession,
  deleteSetupSession,
  getPoll,
  setPollMessageTarget,
  setVotes
} from "./polls.js";
```

Removed (no longer needed in `index.js`): `EmbedBuilder`, `createSetupRows`, `SETUP_PREFIX`, `addMonths`, `getMonthDays`, `monthLabel`, `renderCalendar`, `getSetupSession`, `saveSetupSessions`. Added: `ActionRowBuilder`, `ButtonBuilder`, `ButtonStyle` (for the Link Button), and the voting imports moved to `./voting.js`.

- [ ] **Step 2: Replace `handleDatePollCommand`**

Locate `async function handleDatePollCommand`. Replace its body with:

```javascript
async function handleDatePollCommand(interaction) {
  const session = createSetupSession({
    userId: interaction.user.id,
    channelId: interaction.channelId,
    title: interaction.options.getString("title", true)
  });

  const applicationId = process.env.DISCORD_CLIENT_ID;
  const activityUrl =
    `https://discord.com/activities/${applicationId}` +
    `?datepoll_token=${encodeURIComponent(session.token)}`;

  await interaction.reply({
    content: `**${session.title}** — open the calendar to pick dates:`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Open Calendar →")
          .setStyle(ButtonStyle.Link)
          .setURL(activityUrl)
      )
    ],
    flags: MessageFlags.Ephemeral
  });
}
```

- [ ] **Step 3: Delete `handleSetupInteraction`**

Search `src/index.js` for `async function handleSetupInteraction`. Delete the entire function (about 100 lines) along with any `updateSelectedDates`, `createSetupEmbed` helpers. The InteractionCreate handler (registered earlier in the file) still references it — that gets fixed in the next step.

- [ ] **Step 4: Update the InteractionCreate dispatcher**

Replace the existing dispatch block:

```javascript
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "datepoll") {
      await handleDatePollCommand(interaction);
      return;
    }

    if (interaction.type !== InteractionType.MessageComponent) {
      return;
    }

    if (interaction.customId.startsWith(`${SETUP_PREFIX}:`)) {
      await handleSetupInteraction(interaction);
      return;
    }

    if (interaction.customId.startsWith(`${POLL_PREFIX}:`)) {
      await handlePollInteraction(interaction);
    }
  } catch (error) {
    console.error(error);
    await sendInteractionError(interaction);
  }
});
```

with:

```javascript
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "datepoll") {
      await handleDatePollCommand(interaction);
      return;
    }

    if (interaction.type !== InteractionType.MessageComponent) {
      return;
    }

    if (interaction.customId.startsWith(`${POLL_PREFIX}:`)) {
      await handlePollInteraction(interaction);
    }
  } catch (error) {
    console.error(error);
    await sendInteractionError(interaction);
  }
});
```

- [ ] **Step 5: Syntax check**

Run: `node --check src/index.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Tests still pass**

Run: `npm test`
Expected: `pass 25, fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/index.js
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(index): /datepoll posts an Activity Link Button instead of a dropdown setup view"
```

---

## Task 11: Mount the HTTP server alongside the gateway client

**Files:**

- Modify: `src/index.js`
- Modify: `.env.example`

Wire the gateway client and the Hono server into a single process. Inject the bot's session/poll utilities into the server via `createApp(deps)`. Start the periodic prune timer.

- [ ] **Step 1: Add env-var docs to `.env.example`**

Read the existing `.env.example`. After the last existing variable, append:

```env
# OAuth2 client secret from the Developer Portal (NEVER commit a real one)
DISCORD_CLIENT_SECRET=replace-with-your-client-secret

# Public URL of the Activity (Caddy + DuckDNS subdomain). Used to construct Activity launch URLs.
PUBLIC_URL=https://datepoll.duckdns.org

# Bot HTTP API port (loopback only). Caddy reverse-proxies to this.
API_PORT=3000
```

- [ ] **Step 2: Boot the server from `src/index.js`**

In `src/index.js`, add to the imports (after the existing `./voting.js` import):

```javascript
import { createApp, startServer } from "./server.js";
import { createTokenCache } from "./discord-auth.js";
import {
  getSetupSessionByToken,
  pruneExpiredSessions,
  saveSetupSessions
} from "./polls.js";
```

Below the existing `const client = new Client(...)` line, add:

```javascript
const tokenCache = createTokenCache();

async function publishPoll(session) {
  const channel = await client.channels.fetch(session.channelId);
  if (!channel?.isTextBased?.()) {
    const error = new Error("Target channel is not text-based.");
    error.code = 50001;
    throw error;
  }

  const poll = createPoll({
    title: session.title,
    dates: session.selectedDates,
    createdBy: session.userId
  });

  const message = await channel.send({
    embeds: [createPollEmbed(poll)],
    components: createPollRows(poll)
  });

  setPollMessageTarget(poll, { channelId: channel.id, messageId: message.id });
  return { channelId: channel.id, messageId: message.id };
}

const app = createApp({
  clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  tokenCache,
  fetchImpl: globalThis.fetch,
  sessionsApi: {
    getByToken: getSetupSessionByToken,
    save: saveSetupSessions,
    delete: deleteSetupSession
  },
  publishPoll
});

const apiPort = Number(process.env.API_PORT ?? 3000);
startServer({ port: apiPort, app });
console.log(`HTTP API listening on http://127.0.0.1:${apiPort}`);

setInterval(() => {
  const removed = pruneExpiredSessions();
  if (removed > 0) console.log(`Pruned ${removed} expired sessions`);
}, 15 * 60 * 1000);
```

- [ ] **Step 3: Verify the file parses**

Run: `node --check src/index.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify a freshly-started bot accepts HTTP requests**

The bot will fail to log in to Discord with dummy credentials, but the HTTP server starts in parallel and is reachable before the login attempt errors out.

```bash
DISCORD_TOKEN=dummy DISCORD_CLIENT_ID=dummy DISCORD_CLIENT_SECRET=dummy node src/index.js &
BOT_PID=$!
sleep 2
curl -s http://127.0.0.1:3000/api/health
kill $BOT_PID 2>/dev/null || true
wait $BOT_PID 2>/dev/null || true
```

Expected `curl` output: `{"ok":true}`

The TokenInvalid error after the curl is expected and doesn't indicate a problem with the HTTP server.

- [ ] **Step 5: Tests still pass**

Run: `npm test`
Expected: `pass 25, fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/index.js .env.example
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(index): mount HTTP API and wire publishPoll dependency"
```

---

## Task 12: Vite + React + react-day-picker scaffold

**Files:**

- Create: `web/package.json`, `web/index.html`, `web/vite.config.js`, `web/.gitignore`
- Create: `web/src/main.jsx`, `web/src/App.jsx`, `web/src/styles.css`
- Modify: `.gitignore`

Scaffolds the frontend with the chosen dependencies. The dev server (port 5173) proxies `/api/*` to the bot on `127.0.0.1:3000`.

- [ ] **Step 1: Create `web/package.json`**

Create `web/package.json`:

```json
{
  "name": "datepoll-web",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@discord/embedded-app-sdk": "^2.5.0",
    "react": "^18.3.1",
    "react-day-picker": "^10.0.1",
    "react-dom": "^18.3.1",
    "date-fns": "^4.1.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "vite": "^8.0.14",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Install web dependencies**

Run: `cd web && npm install`
Expected: lockfile created in `web/`; no errors.

- [ ] **Step 3: Create `web/index.html`**

Create `web/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DatePoll</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `web/vite.config.js`**

Create `web/vite.config.js`:

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist",
    sourcemap: false
  },
  test: {
    environment: "jsdom",
    globals: true
  }
});
```

- [ ] **Step 5: Create `web/.gitignore`**

Create `web/.gitignore`:

```text
node_modules
dist
.vite
```

- [ ] **Step 6: Update repo `.gitignore`**

In the root `.gitignore`, append:

```text
web/node_modules/
web/dist/
```

- [ ] **Step 7: Create `web/src/main.jsx`**

Create `web/src/main.jsx`:

```javascript
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 8: Create `web/src/App.jsx`**

Create `web/src/App.jsx`:

```javascript
import React from "react";

export default function App() {
  return (
    <div className="app">
      <h1>DatePoll</h1>
      <p>Loading…</p>
    </div>
  );
}
```

- [ ] **Step 9: Create `web/src/styles.css`**

Create `web/src/styles.css`:

```css
:root {
  --bg: #2b2d31;
  --fg: #f2f3f5;
  --muted: #b5bac1;
  --accent: #5865f2;
  --success: #248045;
  --danger: #f23f42;
  --border: rgba(255, 255, 255, 0.08);
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff;
    --fg: #060607;
    --muted: #4e5058;
    --accent: #5865f2;
    --success: #1a7f37;
    --danger: #d23f3f;
    --border: rgba(0, 0, 0, 0.08);
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
}

.app {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px;
}

button.primary {
  background: var(--accent);
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 10: Verify the dev server starts**

Run: `cd web && npm run dev` (then Ctrl+C after seeing the URL)
Expected: Vite prints `Local: http://localhost:5173/`. No errors.

- [ ] **Step 11: Commit**

```bash
git add web .gitignore
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(web): Vite + React + react-day-picker scaffold"
```

---

## Task 13: Frontend Discord SDK provider + OAuth exchange

**Files:**

- Create: `web/src/api.js`
- Create: `web/src/discord/DiscordProvider.jsx`
- Modify: `web/src/App.jsx`

The provider initializes `@discord/embedded-app-sdk`, runs the OAuth code → access-token exchange via the bot's `/api/discord/token` route, and exposes the result via React context. The provider also reads `datepoll_token` from the URL and exposes it.

- [ ] **Step 1: Create `web/src/api.js`**

Create `web/src/api.js`:

```javascript
export class ApiError extends Error {
  constructor(status, body) {
    super(`API ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch(path, { method = "GET", accessToken, body } = {}) {
  const headers = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, parsed);
  }
  return parsed;
}

export function exchangeAuthCode(code) {
  return apiFetch("/api/discord/token", { method: "POST", body: { code } });
}

export function getSessionState(token, accessToken) {
  return apiFetch(`/api/sessions/${encodeURIComponent(token)}`, { accessToken });
}

export function toggleDate(token, dateKey, accessToken) {
  return apiFetch(`/api/sessions/${encodeURIComponent(token)}/toggle`, {
    method: "POST",
    accessToken,
    body: { dateKey }
  });
}

export function publishPoll(token, accessToken) {
  return apiFetch(`/api/sessions/${encodeURIComponent(token)}/publish`, {
    method: "POST",
    accessToken
  });
}
```

- [ ] **Step 2: Create `web/src/discord/DiscordProvider.jsx`**

Create `web/src/discord/DiscordProvider.jsx`:

```javascript
import React, { createContext, useContext, useEffect, useState } from "react";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { exchangeAuthCode } from "../api.js";

const DiscordContext = createContext(null);

export function useDiscord() {
  const ctx = useContext(DiscordContext);
  if (!ctx) throw new Error("useDiscord must be used within DiscordProvider");
  return ctx;
}

function readSessionTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("datepoll_token");
}

export function DiscordProvider({ children, clientId }) {
  const [state, setState] = useState({
    status: "loading",
    sessionToken: readSessionTokenFromUrl(),
    accessToken: null,
    sdk: null,
    error: null
  });

  useEffect(() => {
    if (!state.sessionToken) {
      setState((s) => ({ ...s, status: "no_session_token" }));
      return;
    }

    let cancelled = false;
    async function init() {
      try {
        const sdk = new DiscordSDK(clientId);
        await sdk.ready();
        const { code } = await sdk.commands.authorize({
          client_id: clientId,
          response_type: "code",
          state: "",
          prompt: "none",
          scope: ["identify"]
        });
        const { access_token } = await exchangeAuthCode(code);
        if (cancelled) return;
        setState((s) => ({ ...s, status: "ready", accessToken: access_token, sdk }));
      } catch (error) {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "auth_failed", error }));
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [clientId, state.sessionToken]);

  return <DiscordContext.Provider value={state}>{children}</DiscordContext.Provider>;
}
```

- [ ] **Step 3: Wire into `web/src/App.jsx`**

Replace `web/src/App.jsx` contents:

```javascript
import React from "react";
import { DiscordProvider, useDiscord } from "./discord/DiscordProvider.jsx";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

function Inner() {
  const { status, error } = useDiscord();
  if (status === "loading") return <p>Connecting to Discord…</p>;
  if (status === "no_session_token") return <p>Open this page from the Discord activity launcher.</p>;
  if (status === "auth_failed") return <p>Couldn't authenticate: {String(error?.message ?? error)}</p>;
  return <p>Authenticated. Calendar coming next.</p>;
}

export default function App() {
  return (
    <div className="app">
      <h1>DatePoll</h1>
      <DiscordProvider clientId={CLIENT_ID}>
        <Inner />
      </DiscordProvider>
    </div>
  );
}
```

- [ ] **Step 4: Add VITE env var template**

Create `web/.env.example`:

```env
VITE_DISCORD_CLIENT_ID=replace-with-your-application-id
```

Document in this file: at dev/build time, the Vite-side reads `VITE_DISCORD_CLIENT_ID` from `web/.env`. The user creates `web/.env` (gitignored via `web/.gitignore`'s `node_modules` plus the dotfile is filtered separately) and pastes their Client ID.

Also append to `web/.gitignore`:

```text
.env
.env.*
```

- [ ] **Step 5: Confirm the build still succeeds**

Run: `cd web && npm run build`
Expected: `dist/` populated; no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src web/.env.example web/.gitignore
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(web): DiscordProvider + OAuth code exchange"
```

---

## Task 14: Frontend SessionLoader + ErrorScreens

**Files:**

- Create: `web/src/session/SessionLoader.jsx`
- Create: `web/src/errors/ErrorScreens.jsx`
- Modify: `web/src/App.jsx`

Loads `GET /api/sessions/:token` after auth succeeds. Maps response shapes to either rendering children (with session state) or showing an error screen.

- [ ] **Step 1: Create `web/src/errors/ErrorScreens.jsx`**

Create `web/src/errors/ErrorScreens.jsx`:

```javascript
import React from "react";

export function NotInDiscordScreen() {
  return (
    <div className="error">
      <h2>Open this from Discord</h2>
      <p>This page is only meaningful inside Discord's Activity panel. Run <code>/datepoll</code> in a channel and click <strong>Open Calendar →</strong>.</p>
    </div>
  );
}

export function ExpiredScreen() {
  return (
    <div className="error">
      <h2>Session expired</h2>
      <p>This date-poll session has timed out. Close this panel and run <code>/datepoll</code> again.</p>
    </div>
  );
}

export function ForbiddenScreen() {
  return (
    <div className="error">
      <h2>Not your calendar</h2>
      <p>Only the person who ran <code>/datepoll</code> can use this calendar.</p>
    </div>
  );
}

export function NetworkErrorScreen({ onRetry }) {
  return (
    <div className="error">
      <h2>Network problem</h2>
      <p>Couldn't reach DatePoll's server.</p>
      <button className="primary" onClick={onRetry}>Try again</button>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/session/SessionLoader.jsx`**

Create `web/src/session/SessionLoader.jsx`:

```javascript
import React, { useEffect, useState } from "react";
import { getSessionState, ApiError } from "../api.js";
import { useDiscord } from "../discord/DiscordProvider.jsx";
import {
  ExpiredScreen,
  ForbiddenScreen,
  NetworkErrorScreen
} from "../errors/ErrorScreens.jsx";

export function SessionLoader({ children }) {
  const { sessionToken, accessToken, status } = useDiscord();
  const [state, setState] = useState({ phase: "loading", session: null, error: null });

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    async function load() {
      try {
        const session = await getSessionState(sessionToken, accessToken);
        if (!cancelled) setState({ phase: "ready", session, error: null });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError) {
          if (error.status === 410) setState({ phase: "expired", session: null, error });
          else if (error.status === 403) setState({ phase: "forbidden", session: null, error });
          else setState({ phase: "network", session: null, error });
        } else {
          setState({ phase: "network", session: null, error });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [status, sessionToken, accessToken]);

  if (state.phase === "loading") return <p>Loading calendar…</p>;
  if (state.phase === "expired") return <ExpiredScreen />;
  if (state.phase === "forbidden") return <ForbiddenScreen />;
  if (state.phase === "network") {
    return <NetworkErrorScreen onRetry={() => setState({ phase: "loading", session: null, error: null })} />;
  }
  return children({ session: state.session, setSession: (s) => setState({ phase: "ready", session: s, error: null }) });
}
```

- [ ] **Step 3: Wire SessionLoader into `web/src/App.jsx`**

Replace `web/src/App.jsx` contents:

```javascript
import React from "react";
import { DiscordProvider, useDiscord } from "./discord/DiscordProvider.jsx";
import { SessionLoader } from "./session/SessionLoader.jsx";
import { NotInDiscordScreen } from "./errors/ErrorScreens.jsx";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

function Inner() {
  const { status, error } = useDiscord();
  if (status === "loading") return <p>Connecting to Discord…</p>;
  if (status === "no_session_token") return <NotInDiscordScreen />;
  if (status === "auth_failed") return <p>Couldn't authenticate: {String(error?.message ?? error)}</p>;
  return (
    <SessionLoader>
      {({ session }) => (
        <div>
          <p>Loaded session: <strong>{session.title}</strong></p>
          <p>{session.selectedDates.length} dates selected (calendar comes next).</p>
        </div>
      )}
    </SessionLoader>
  );
}

export default function App() {
  return (
    <div className="app">
      <h1>DatePoll</h1>
      <DiscordProvider clientId={CLIENT_ID}>
        <Inner />
      </DiscordProvider>
    </div>
  );
}
```

- [ ] **Step 4: Build to confirm everything compiles**

Run: `cd web && npm run build`
Expected: `dist/` produced; no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(web): SessionLoader + ErrorScreens"
```

---

## Task 15: Calendar component with `react-day-picker`

**Files:**

- Create: `web/src/calendar/Calendar.jsx`, `web/src/calendar/Summary.jsx`
- Modify: `web/src/App.jsx`, `web/src/styles.css`

Multi-select calendar. Clicking a day calls `toggleDate(token, dateKey, accessToken)`; on response, updates session state via `setSession`. Past dates are unselectable. Optimistic update: local state flips immediately, reverts if the API call fails.

- [ ] **Step 1: Create `web/src/calendar/Summary.jsx`**

Create `web/src/calendar/Summary.jsx`:

```javascript
import React from "react";

function formatLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function Summary({ selectedDates }) {
  if (selectedDates.length === 0) {
    return <p className="muted">No dates selected yet — tap a day to add it.</p>;
  }
  const sorted = [...selectedDates].sort();
  const labels = sorted.map(formatLabel);
  if (sorted.length <= 6) {
    return <p><strong>{sorted.length}</strong> date{sorted.length === 1 ? "" : "s"} selected — {labels.join(", ")}</p>;
  }
  return <p><strong>{sorted.length}</strong> dates selected — {labels.slice(0, 5).join(", ")}, +{sorted.length - 5} more</p>;
}
```

- [ ] **Step 2: Create `web/src/calendar/Calendar.jsx`**

Create `web/src/calendar/Calendar.jsx`:

```javascript
import React, { useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Summary } from "./Summary.jsx";
import { toggleDate } from "../api.js";
import { useDiscord } from "../discord/DiscordProvider.jsx";

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function Calendar({ session, setSession }) {
  const { sessionToken, accessToken } = useDiscord();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function onDayClick(date) {
    const key = toDateKey(date);
    const wasSelected = session.selectedDates.includes(key);
    const optimistic = wasSelected
      ? session.selectedDates.filter((k) => k !== key)
      : [...session.selectedDates, key];
    setSession({ ...session, selectedDates: optimistic });
    setSaving(true);
    setError(null);
    try {
      const { selectedDates } = await toggleDate(sessionToken, key, accessToken);
      setSession({ ...session, selectedDates });
    } catch (err) {
      setSession({ ...session, selectedDates: session.selectedDates });
      setError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const selectedDates = session.selectedDates.map(fromDateKey);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="calendar">
      <h2>{session.title}</h2>
      <Summary selectedDates={session.selectedDates} />
      <DayPicker
        mode="multiple"
        selected={selectedDates}
        onDayClick={onDayClick}
        disabled={{ before: today }}
      />
      {saving && <p className="muted">Saving…</p>}
      {error && <p className="error-inline">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Update `web/src/App.jsx`**

Replace `web/src/App.jsx` contents:

```javascript
import React from "react";
import { DiscordProvider, useDiscord } from "./discord/DiscordProvider.jsx";
import { SessionLoader } from "./session/SessionLoader.jsx";
import { Calendar } from "./calendar/Calendar.jsx";
import { NotInDiscordScreen } from "./errors/ErrorScreens.jsx";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

function Inner() {
  const { status, error } = useDiscord();
  if (status === "loading") return <p>Connecting to Discord…</p>;
  if (status === "no_session_token") return <NotInDiscordScreen />;
  if (status === "auth_failed") return <p>Couldn't authenticate: {String(error?.message ?? error)}</p>;
  return (
    <SessionLoader>
      {({ session, setSession }) => <Calendar session={session} setSession={setSession} />}
    </SessionLoader>
  );
}

export default function App() {
  return (
    <div className="app">
      <DiscordProvider clientId={CLIENT_ID}>
        <Inner />
      </DiscordProvider>
    </div>
  );
}
```

- [ ] **Step 4: Add calendar styles**

Append to `web/src/styles.css`:

```css
.calendar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.calendar h2 {
  margin: 0;
  font-size: 18px;
}

.muted { color: var(--muted); font-size: 13px; }

.error, .error-inline {
  color: var(--danger);
  font-size: 13px;
}

.rdp-root {
  --rdp-accent-color: var(--accent);
  --rdp-background-color: transparent;
  margin: 0;
}
```

- [ ] **Step 5: Verify build**

Run: `cd web && npm run build`
Expected: success; bundle includes `react-day-picker`.

- [ ] **Step 6: Commit**

```bash
git add web/src web/src/styles.css
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(web): Calendar with react-day-picker"
```

---

## Task 16: PublishButton + success screen

**Files:**

- Create: `web/src/publish/PublishButton.jsx`
- Modify: `web/src/calendar/Calendar.jsx`

POSTs to `/publish`, shows a success screen for 2 seconds, then calls `sdk.commands.close()` to dismiss the activity panel.

- [ ] **Step 1: Create `web/src/publish/PublishButton.jsx`**

Create `web/src/publish/PublishButton.jsx`:

```javascript
import React, { useState } from "react";
import { publishPoll, ApiError } from "../api.js";
import { useDiscord } from "../discord/DiscordProvider.jsx";

export function PublishButton({ session }) {
  const { sessionToken, accessToken, sdk } = useDiscord();
  const [state, setState] = useState({ phase: "idle", error: null });

  async function onPublish() {
    setState({ phase: "publishing", error: null });
    try {
      await publishPoll(sessionToken, accessToken);
      setState({ phase: "published", error: null });
      setTimeout(() => {
        if (sdk && sdk.commands && typeof sdk.commands.close === "function") {
          sdk.commands.close();
        }
      }, 2000);
    } catch (err) {
      let message = "Couldn't publish.";
      if (err instanceof ApiError && err.body?.error === "missing_permissions") {
        message = "Bot lacks View Channel or Send Messages in this channel.";
      }
      setState({ phase: "idle", error: message });
    }
  }

  if (state.phase === "published") {
    return (
      <div className="success">
        <h2>Poll published</h2>
        <p>You can close this panel.</p>
      </div>
    );
  }

  return (
    <div className="publish-row">
      <button
        className="primary"
        onClick={onPublish}
        disabled={state.phase === "publishing" || session.selectedDates.length === 0}
      >
        {state.phase === "publishing" ? "Publishing…" : `Publish (${session.selectedDates.length})`}
      </button>
      {state.error && <p className="error-inline">{state.error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `web/src/calendar/Calendar.jsx`**

Append to the imports in `web/src/calendar/Calendar.jsx`:

```javascript
import { PublishButton } from "../publish/PublishButton.jsx";
```

Modify the rendered JSX. Replace this block:

```jsx
      {saving && <p className="muted">Saving…</p>}
      {error && <p className="error-inline">{error}</p>}
    </div>
```

with:

```jsx
      {saving && <p className="muted">Saving…</p>}
      {error && <p className="error-inline">{error}</p>}
      <PublishButton session={session} />
    </div>
```

- [ ] **Step 3: Add success styles**

Append to `web/src/styles.css`:

```css
.success {
  padding: 24px;
  background: var(--success);
  color: white;
  border-radius: 8px;
  text-align: center;
}

.success h2 { margin: 0 0 8px; }

.publish-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
```

- [ ] **Step 4: Build**

Run: `cd web && npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add web/src web/src/styles.css
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "feat(web): PublishButton + success screen"
```

---

## Task 17: Operational checklist (Discord Developer Portal + DuckDNS + Caddy + systemd)

**Files:**

- Create: `docs/OPERATIONS.md`
- Create: `deploy/Caddyfile`, `deploy/datepoll.service`
- Create: `scripts/deploy.sh`

Captures every manual step the user must run on their server, plus the deploy script. No code — operational. This is the only task that produces no Node.js changes; the implementer (or the user) executes the steps on the live infrastructure.

- [ ] **Step 1: Create `deploy/Caddyfile`**

Create `deploy/Caddyfile`:

```caddy
{$PUBLIC_HOST} {
  root * /var/www/datepoll/dist
  encode gzip
  try_files {path} /index.html
  file_server

  handle /api/* {
    reverse_proxy 127.0.0.1:3000
  }
}
```

- [ ] **Step 2: Create `deploy/datepoll.service`**

Create `deploy/datepoll.service`:

```ini
[Unit]
Description=DatePoll Discord bot + HTTP API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/datepoll
EnvironmentFile=/opt/datepoll/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
User=datepoll

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Create `scripts/deploy.sh`**

Create `scripts/deploy.sh` (and `chmod +x` it):

```bash
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
```

- [ ] **Step 4: Create `docs/OPERATIONS.md`**

Create `docs/OPERATIONS.md`:

```markdown
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

```

- [ ] **Step 5: Commit**

```bash
chmod +x scripts/deploy.sh
git add deploy scripts/deploy.sh docs/OPERATIONS.md
git -c user.email="tools@vpathai.com" -c user.name="Klemens" commit -m "docs(ops): manual setup checklist + Caddyfile + systemd + deploy script"
```

---

## Task 18: End-to-end smoke test

**Files:** None — operational verification only.

This task is the final manual end-to-end test. It is the only task without a code change; the user runs it against the deployed system to confirm the entire pipeline works.

- [ ] **Step 1: Confirm production env**

On the server: `sudo systemctl status caddy datepoll` — both `active (running)`.

Test the public URL: `curl -s https://datepoll.duckdns.org/api/health` should return `{"ok":true}`.

- [ ] **Step 2: Run `/datepoll title:Smoke Test` in the dev guild**

Discord client → channel → `/datepoll title:Smoke Test`.

Expected: ephemeral message `**Smoke Test** — open the calendar to pick dates:` with a single Link Button `Open Calendar →`.

- [ ] **Step 3: Click the Link Button**

Expected: Discord shows the unverified-app warning on first launch. Acknowledge. The Activity panel opens with the React app inside it.

After 1–2 seconds: title "Smoke Test", "No dates selected yet — tap a day to add it.", calendar grid, `Publish (0)` button (disabled).

- [ ] **Step 4: Pick 3 dates**

Click 3 future days. Expected:

- Each click flips the cell green.
- Summary updates to `3 dates selected — …`.
- `Publish (3)` enables.

- [ ] **Step 5: Click an already-selected date**

Expected: it flips back. Count drops.

- [ ] **Step 6: Navigate to a future month and pick more dates**

Expected: stable. Summary reflects all dates across months.

- [ ] **Step 7: Click Publish**

Expected:

- Button shows `Publishing…`.
- Within ~1 second the panel switches to the green `Poll published` screen.
- After 2 seconds the panel auto-closes.
- In the text channel, the public poll embed appears with the selected dates and the existing StringSelectMenu voting view.

- [ ] **Step 8: Cast a vote on the public poll**

Expected: vote count updates; voter mention appears. (Voting view is unchanged from main.)

- [ ] **Step 9: Open the link from a stale ephemeral 1h+ later**

(After waiting an hour, or by manually editing `data/sessions.json` to backdate `lastActiveAt`.)

Expected: the Activity panel shows the "Session expired" screen.

- [ ] **Step 10: Confirm logs are clean**

`sudo journalctl -u datepoll -n 50` — should show only the `HTTP API listening` line and any `Pruned N expired sessions` messages. No stack traces.

If every step passes, the Activity calendar is production-ready.

---

## Self-Review Notes

Spec coverage check against `docs/superpowers/specs/2026-05-27-activity-calendar-design.md`:

- §1 Goal — Tasks 10, 12–16 deliver the Activity end to end. ✓
- §2 Non-goals — explicitly omitted; no tasks add verification, multi-language, or migration. ✓
- §3 Architecture — Task 4 mounts Hono; Task 11 boots the server with deps; Task 17 sets up Caddy + DuckDNS. ✓
- §4 User flow — every step has a corresponding task (slash command → link button: Task 10; SDK ready/auth: Task 13; load: Task 14; toggle: Tasks 7, 15; publish: Tasks 8, 16). ✓
- §5 Developer Portal — Task 17, §1. ✓
- §6 Server infra — Task 17, §§2–7. ✓
- §7 API surface — Tasks 4 (health), 5 (token), 6 (GET), 7 (toggle), 8 (publish). ✓
- §8 Frontend — Tasks 12 (scaffold), 13 (Discord), 14 (loader/errors), 15 (calendar), 16 (publish). ✓
- §9 Data model — Task 2 introduces `token` + `lastActiveAt`. ✓
- §10 Project structure — mirrored in this plan's File Structure section. ✓
- §11 Local dev — Task 17, §10. ✓
- §12 Deploy — Task 17 step 3 (deploy script) + §8. ✓
- §13 Testing — Tasks 2, 3, 4, 5, 6, 7, 8 cover bot routes; frontend tests are intentionally minimal (covered manually in Task 18 per the user's earlier preference to keep scope tight). ✓
- §14 Security — auth middleware (Task 6) is the central control. Discord client secret never sent to frontend. ✓
- §15 Edge cases — error screens (Task 14), 50001/50013 (Task 8). ✓
- §16 Rollout — Task 17 (single deploy). ✓
- §17 Open question 1 (URL query param) — Task 18's smoke test will reveal if the token survives the iframe handoff. If it doesn't, the fallback (`userId`-keyed most-recent-session lookup) is a follow-up. ✓
- §18 Success criteria — every bullet maps to a Task 18 step. ✓
- §19 Estimated scope — 18 tasks, in line with the spec's "~15 tasks" estimate. ✓
