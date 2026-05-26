import { REST, Routes, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("datepoll")
    .setDescription("Create a multiple-choice date poll.")
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Poll title")
        .setRequired(true)
        .setMaxLength(100)
    )
].map((command) => command.toJSON());

export async function registerCommands({
  token,
  clientId,
  guildId,
  logger = console
}) {
  if (!token || !clientId) {
    throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required.");
  }

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands
      });
      logger.log(`Registered commands for guild ${guildId}.`);
      return;
    }

    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    logger.log("Registered global commands. Global updates can take up to an hour.");
  } catch (error) {
    if (error.status === 401) {
      throw new Error(
        "Discord rejected DISCORD_TOKEN. Reset/copy the Bot token from Developer Portal > Bot and update .env."
      );
    }

    throw error;
  }
}
