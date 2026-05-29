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
  assert.equal(calls[0].init.body.get("redirect_uri"), "https://127.0.0.1");
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
