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
