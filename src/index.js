import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  InteractionType,
  MessageFlags
} from "discord.js";
import { POLL_PREFIX } from "./components.js";
import { registerCommands } from "./commands.js";
import { createPollEmbed, createPollRows } from "./voting.js";
import { createApp, startServer } from "./server.js";
import { createTokenCache } from "./discord-auth.js";
import {
  getSetupSessionByToken,
  pruneExpiredSessions,
  saveSetupSessions
} from "./polls.js";
import {
  createPoll,
  createSetupSession,
  deleteSetupSession,
  getPoll,
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

const tokenCache = createTokenCache();

async function publishPoll(session) {
  const channel = await client.channels.fetch(session.channelId);
  if (!channel?.isTextBased?.()) {
    const error = new Error("Target channel is not text-based.");
    error.code = 50001;
    throw error;
  }

  const poll = createPoll({
    title: session.title,
    dates: session.selectedDates,
    createdBy: session.userId
  });

  const message = await channel.send({
    embeds: [createPollEmbed(poll)],
    components: createPollRows(poll)
  });

  setPollMessageTarget(poll, { channelId: channel.id, messageId: message.id });
  return { channelId: channel.id, messageId: message.id };
}

const app = createApp({
  clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  tokenCache,
  fetchImpl: globalThis.fetch,
  sessionsApi: {
    getByToken: getSetupSessionByToken,
    save: saveSetupSessions,
    delete: deleteSetupSession
  },
  publishPoll
});

const apiPort = Number(process.env.API_PORT ?? 3000);
startServer({ port: apiPort, app });
console.log(`HTTP API listening on http://127.0.0.1:${apiPort}`);

setInterval(() => {
  const removed = pruneExpiredSessions();
  if (removed > 0) console.log(`Pruned ${removed} expired sessions`);
}, 15 * 60 * 1000);

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

  const applicationId = process.env.DISCORD_CLIENT_ID;
  const activityUrl =
    `https://discord.com/activities/${applicationId}` +
    `?datepoll_token=${encodeURIComponent(session.token)}`;

  await interaction.reply({
    content: `**${session.title}** — open the calendar to pick dates:`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Open Calendar →")
          .setStyle(ButtonStyle.Link)
          .setURL(activityUrl)
      )
    ],
    flags: MessageFlags.Ephemeral
  });
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
