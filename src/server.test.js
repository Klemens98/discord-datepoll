import { test, mock } from "node:test";
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
