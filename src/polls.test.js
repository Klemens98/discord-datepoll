import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  createSetupSession,
  deleteSetupSession,
  getSetupSession,
  getSetupSessionByToken,
  getSetupSessionForUser,
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

test("getSetupSessionForUser returns the newest active session for that user and channel", () => {
  const older = createSetupSession({ userId: "u1", channelId: "c1", title: "older" });
  older.lastActiveAt = Date.now() - 1000;
  const newer = createSetupSession({ userId: "u1", channelId: "c1", title: "newer" });
  const otherChannel = createSetupSession({ userId: "u1", channelId: "c2", title: "other" });

  assert.equal(getSetupSessionForUser({ userId: "u1", channelId: "c1" }), newer);
  assert.equal(getSetupSessionForUser({ userId: "u1", channelId: "c2" }), otherChannel);
  assert.equal(getSetupSessionForUser({ userId: "u9", channelId: "c1" }), undefined);

  deleteSetupSession(older.id);
  deleteSetupSession(newer.id);
  deleteSetupSession(otherChannel.id);
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
