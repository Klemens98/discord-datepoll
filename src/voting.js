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
