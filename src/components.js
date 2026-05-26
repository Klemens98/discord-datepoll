import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} from "discord.js";
import { dateLabel, getMonthDays } from "./date-utils.js";

export const POLL_PREFIX = "datepoll";
export const SETUP_PREFIX = "datesetup";

export function setupCustomId(sessionId, action) {
  return `${SETUP_PREFIX}:${sessionId}:${action}`;
}

export function pollCustomId(pollId, chunkIndex) {
  return `${POLL_PREFIX}:${pollId}:${chunkIndex}`;
}

export function createSetupRows(session) {
  const days = getMonthDays(session.visibleMonth);
  const firstChunk = days.slice(0, 25);
  const secondChunk = days.slice(25);
  const rows = [];

  rows.push(
    new ActionRowBuilder().addComponents(
      createDaySelect(session, firstChunk, "days-a", "Pick days 1-25")
    )
  );

  if (secondChunk.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        createDaySelect(session, secondChunk, "days-b", "Pick days 26-31")
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(setupCustomId(session.id, "prev"))
        .setLabel("This month")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(session.monthOffset === 0),
      new ButtonBuilder()
        .setCustomId(setupCustomId(session.id, "next"))
        .setLabel("Next month")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(session.monthOffset === 1),
      new ButtonBuilder()
        .setCustomId(setupCustomId(session.id, "publish"))
        .setLabel("Publish poll")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(session.selectedDates.size === 0),
      new ButtonBuilder()
        .setCustomId(setupCustomId(session.id, "cancel"))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger)
    )
  );

  return rows;
}

function createDaySelect(session, days, idSuffix, placeholder) {
  const values = days.map((day) => day.key);
  const selectedInChunk = values.filter((value) => session.selectedDates.has(value));

  return new StringSelectMenuBuilder()
    .setCustomId(setupCustomId(session.id, idSuffix))
    .setPlaceholder(placeholder)
    .setMinValues(0)
    .setMaxValues(values.length)
    .addOptions(
      days.map((day) => ({
        label: String(day.day),
        description: dateLabel(day.key),
        value: day.key,
        default: selectedInChunk.includes(day.key)
      }))
    );
}

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
