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

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, AUTO_DEPLOY_COMMANDS } = process.env;

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is required.");
}

if (DISCORD_TOKEN.startsWith("your-")) {
  throw new Error("Replace DISCORD_TOKEN in .env with your real bot token.");
}

const shouldAutoDeployCommands =
  AUTO_DEPLOY_COMMANDS === "true" || (AUTO_DEPLOY_COMMANDS !== "false" && Boolean(DISCORD_GUILD_ID));

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
});

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

async function handleDatePollCommand(interaction) {
  const session = createSetupSession({
    userId: interaction.user.id,
    channelId: interaction.channelId,
    title: interaction.options.getString("title", true)
  });

  await interaction.reply({
    embeds: [createSetupEmbed(session)],
    components: createSetupRows(session),
    flags: MessageFlags.Ephemeral
  });
}

async function handleSetupInteraction(interaction) {
  const [, sessionId, action] = interaction.customId.split(":");
  const session = getSetupSession(sessionId);

  if (!session) {
    await interaction.reply({
      content: "This setup session expired. Run `/datepoll` again.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.user.id !== session.userId) {
    await interaction.reply({
      content: "Only the person creating this poll can change these dates.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.isStringSelectMenu() && (action === "days-a" || action === "days-b")) {
    updateSelectedDates(session, action, interaction.values);
    saveSetupSessions();
    await interaction.update({
      embeds: [createSetupEmbed(session)],
      components: createSetupRows(session)
    });
    return;
  }

  if (action === "cancel") {
    deleteSetupSession(session.id);
    await interaction.update({
      content: "Date poll setup cancelled.",
      components: []
    });
    return;
  }

  if (action === "prev" || action === "next") {
    session.monthOffset = action === "prev" ? 0 : 1;
    session.visibleMonth = addMonths(session.startMonth, session.monthOffset);
    saveSetupSessions();
    await interaction.update({
      embeds: [createSetupEmbed(session)],
      components: createSetupRows(session)
    });
    return;
  }

  if (action === "publish") {
    const poll = createPoll({
      title: session.title,
      dates: session.selectedDates,
      createdBy: interaction.user.id
    });
    const pollPayload = {
      embeds: [createPollEmbed(poll)],
      components: createPollRows(poll)
    };

    try {
      if (interaction.channel?.isTextBased()) {
        const message = await interaction.channel.send(pollPayload);
        setPollMessageTarget(poll, {
          channelId: interaction.channel.id,
          messageId: message.id
        });
      } else {
        const channel = await interaction.client.channels.fetch(session.channelId);
        if (!channel?.isTextBased()) {
          throw new Error("Target channel is not text-based.");
        }
        const message = await channel.send(pollPayload);
        setPollMessageTarget(poll, {
          channelId: channel.id,
          messageId: message.id
        });
      }
    } catch (error) {
      if (error.code === 50001 || error.code === 50013) {
        await interaction.reply({
          content:
            "I can't post in that channel. Please grant this bot `View Channel` and `Send Messages`, then try `/datepoll` again.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      throw error;
    }

    deleteSetupSession(session.id);
    await interaction.update({
      content: "Poll published.",
      components: []
    });
  }
}

async function handlePollInteraction(interaction) {
  const [, pollId] = interaction.customId.split(":");
  const poll = getPoll(pollId);

  if (!poll || !interaction.isStringSelectMenu()) {
    await interaction.reply({
      content: "This poll is no longer active.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const previousVotes = poll.votes.get(interaction.user.id) ?? new Set();
  const chunkValues = new Set(
    interaction.component.options.map((option) => option.value)
  );
  const votesOutsideChunk = [...previousVotes].filter((key) => !chunkValues.has(key));
  const newVotes = [...new Set([...votesOutsideChunk, ...interaction.values])];

  setVotes(poll, interaction.user.id, newVotes);
  await refreshPollMessage(poll);

  await interaction.update({
    embeds: [createPollEmbed(poll)],
    components: createPollRows(poll)
  });
}

async function refreshPollMessage(poll) {
  if (!poll.channelId || !poll.messageId) {
    return;
  }

  try {
    const channel = await client.channels.fetch(poll.channelId);
    if (!channel?.isTextBased()) {
      return;
    }
    const message = await channel.messages.fetch(poll.messageId);
    await message.edit({
      embeds: [createPollEmbed(poll)],
      components: createPollRows(poll)
    });
  } catch (error) {
    console.warn("Could not refresh poll message:", error.message ?? error);
  }
}

function updateSelectedDates(session, action, selectedValues) {
  const days = getMonthDays(session.visibleMonth);
  const chunk = action === "days-b" ? days.slice(25) : days.slice(0, 25);
  const chunkKeys = new Set(chunk.map((day) => day.key));

  for (const key of chunkKeys) {
    session.selectedDates.delete(key);
  }

  for (const key of selectedValues) {
    session.selectedDates.add(key);
  }
}

function createSetupEmbed(session) {
  return new EmbedBuilder()
    .setTitle(`Create date poll: ${session.title}`)
    .setDescription(
      [
        `**${monthLabel(session.visibleMonth)}**`,
        renderCalendar(session.visibleMonth, session.selectedDates),
        `${session.selectedDates.size} date(s) selected.`
      ].join("\n")
    )
    .setColor(0x3182ce);
}

async function sendInteractionError(interaction) {
  const response = {
    content: "Something went wrong while handling that interaction.",
    flags: MessageFlags.Ephemeral
  };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  } catch (error) {
    if (error.code === 10062 || error.code === 40060) {
      console.warn(`Skipped fallback interaction reply: ${error.message}`);
      return;
    }

    console.error(error);
  }
}

client.login(DISCORD_TOKEN).catch((error) => {
  if (error.code === "TokenInvalid") {
    console.error(
      "Discord rejected DISCORD_TOKEN. Reset/copy the Bot token from Developer Portal > Bot and update .env."
    );
    process.exit(1);
  }

  throw error;
});

if (shouldAutoDeployCommands) {
  if (!DISCORD_CLIENT_ID) {
    console.warn("AUTO_DEPLOY_COMMANDS is enabled, but DISCORD_CLIENT_ID is missing.");
  } else {
    try {
      await registerCommands({
        token: DISCORD_TOKEN,
        clientId: DISCORD_CLIENT_ID,
        guildId: DISCORD_GUILD_ID
      });
      console.log("Auto-deployed slash commands at startup.");
    } catch (error) {
      console.error("Failed to auto-deploy slash commands:", error.message ?? error);
    }
  }
}
