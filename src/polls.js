import { EmbedBuilder } from "discord.js";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dateLabel } from "./date-utils.js";

const polls = new Map();
const sessions = new Map();
const DATA_FILE = fileURLToPath(new URL("../data/polls.json", import.meta.url));
const SESSIONS_FILE = fileURLToPath(new URL("../data/sessions.json", import.meta.url));

export const SESSION_TTL_MS = 60 * 60 * 1000;

function generateSessionToken() {
  return randomBytes(32).toString("base64url");
}

loadPolls();
loadSessions();

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

export function deleteSetupSession(id) {
  sessions.delete(id);
  saveSessions();
}

export function saveSetupSessions() {
  saveSessions();
}

export function createPoll({ title, dates, createdBy, channelId = null, messageId = null }) {
  const poll = {
    id: crypto.randomUUID(),
    title,
    dates: [...dates].sort(),
    createdBy,
    channelId,
    messageId,
    votes: new Map()
  };

  polls.set(poll.id, poll);
  savePolls();
  return poll;
}

export function getPoll(id) {
  return polls.get(id);
}

export function setVotes(poll, userId, dates) {
  if (dates.length === 0) {
    poll.votes.delete(userId);
  } else {
    poll.votes.set(userId, new Set(dates));
  }

  savePolls();
}

export function setPollMessageTarget(poll, { channelId, messageId }) {
  poll.channelId = channelId;
  poll.messageId = messageId;
  savePolls();
}

export function serializePoll(poll) {
  const counts = new Map(poll.dates.map((key) => [key, 0]));
  for (const selectedDates of poll.votes.values()) {
    for (const key of selectedDates) {
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    }
  }

  return {
    id: poll.id,
    title: poll.title,
    createdBy: poll.createdBy,
    channelId: poll.channelId,
    messageId: poll.messageId,
    dates: poll.dates.map((key) => ({
      key,
      label: dateLabel(key),
      count: counts.get(key),
      voters: [...poll.votes.entries()]
        .filter(([, selectedDates]) => selectedDates.has(key))
        .map(([userId]) => userId)
    }))
  };
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

function loadPolls() {
  if (!existsSync(DATA_FILE)) {
    return;
  }

  const savedPolls = JSON.parse(readFileSync(DATA_FILE, "utf8"));

  for (const savedPoll of savedPolls) {
    polls.set(savedPoll.id, {
      ...savedPoll,
      votes: new Map(
        Object.entries(savedPoll.votes).map(([userId, dates]) => [
          userId,
          new Set(dates)
        ])
      )
    });
  }
}

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

function savePolls() {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  const savedPolls = [...polls.values()].map((poll) => ({
    ...poll,
    votes: Object.fromEntries(
      [...poll.votes.entries()].map(([userId, dates]) => [userId, [...dates]])
    )
  }));

  writeFileSync(DATA_FILE, JSON.stringify(savedPolls, null, 2));
}

function saveSessions() {
  mkdirSync(dirname(SESSIONS_FILE), { recursive: true });
  const savedSessions = [...sessions.values()].map((session) => ({
    ...session,
    selectedDates: [...session.selectedDates]
  }));

  writeFileSync(SESSIONS_FILE, JSON.stringify(savedSessions, null, 2));
}
