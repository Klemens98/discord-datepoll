import "dotenv/config";
import { registerCommands } from "./commands.js";

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required.");
}

const placeholders = [
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID
].filter(Boolean);

if (placeholders.some((value) => value.startsWith("your-"))) {
  throw new Error(
    "Replace the placeholder values in .env with real Discord application values before deploying."
  );
}

await registerCommands({
  token: DISCORD_TOKEN,
  clientId: DISCORD_CLIENT_ID,
  guildId: DISCORD_GUILD_ID
});
