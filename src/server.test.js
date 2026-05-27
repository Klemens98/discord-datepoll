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
