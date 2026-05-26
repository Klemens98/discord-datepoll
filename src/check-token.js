import "dotenv/config";

const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is required.");
}

const dotCount = (DISCORD_TOKEN.match(/\./g) ?? []).length;

console.log(`Token length: ${DISCORD_TOKEN.length}`);
console.log(`Dot count: ${dotCount}`);
console.log(`Has whitespace: ${/\s/.test(DISCORD_TOKEN)}`);

const response = await fetch("https://discord.com/api/v10/users/@me", {
  headers: {
    Authorization: `Bot ${DISCORD_TOKEN}`,
    "User-Agent": "DiscordBot (datepoll, 1.0)"
  }
});

if (response.ok) {
  const bot = await response.json();
  console.log(`Token accepted for bot: ${bot.username} (${bot.id})`);
} else {
  const body = await response.text();
  console.log(`Discord rejected token with status ${response.status}.`);
  console.log(body);
}
