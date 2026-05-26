import { EmbedBuilder } from "discord.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dateLabel } from "./date-utils.js";

const polls = new Map();
const sessions = new Map();
const DATA_FILE = fileURLToPath(new URL("../data/polls.json", import.meta.url));
const SESSIONS_FILE = fileURLToPath(new URL("../data/sessions.json", import.meta.url));

loadPolls();
loadSessions();

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

export function getSetupSession(id) {
  return sessions.get(id);
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
