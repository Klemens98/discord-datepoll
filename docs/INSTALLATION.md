# DatePoll Installation Guide

This guide covers complete setup:

- Create Discord app + bot
- Configure `.env`
- Invite bot to your server
- Register commands
- Run bot

## 1) Prerequisites

- Node.js `18+` (Node `20+` recommended)
- A Discord server where you can add apps/bots
- Discord Developer Portal access

## 2) Install Dependencies

From project root:

```powershell
npm install
```

## 3) Create Discord Application + Bot

1. Open: `https://discord.com/developers/applications`
2. Click `New Application`
3. Name it (for example `DatePoll`)
4. Open the app, then:
   - `General Information` -> copy `Application ID`
   - `Bot` -> click `Add Bot` (if missing)
   - `Bot` -> `Reset Token` / `View Token` -> copy token

Important:
- Use the token from the **Bot** page.
- Do **not** use OAuth2 Client Secret as `DISCORD_TOKEN`.

## 4) Configure Environment

Create `.env`:

```powershell
copy .env.example .env
```

Set values:

```env
DISCORD_TOKEN=your_bot_token_from_bot_page
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_server_id
AUTO_DEPLOY_COMMANDS=true
```

### How to get `DISCORD_GUILD_ID`

1. Discord `User Settings` -> `Advanced`
2. Enable `Developer Mode`
3. Right-click your server icon -> `Copy Server ID`

## 5) Invite Bot to Server

Use this URL (replace client id if needed):

```text
https://discord.com/oauth2/authorize?client_id=1508836370158850155&scope=bot%20applications.commands&permissions=2147568704
```

Notes:
- `scope=bot applications.commands` is required.
- Without `bot` scope, app appears in integrations but not as server member.

## 6) Start Bot

```powershell
npm start
```

Expected log lines:

- `Registered commands for guild ...`
- `Auto-deployed slash commands at startup.`
- `Logged in as ...`

## 7) Use in Discord

1. Run `/datepoll title: ...`
2. Select dates
3. Publish poll
4. Users vote via select menus in the poll message

## 8) Updating Commands After Code Changes

With `AUTO_DEPLOY_COMMANDS=true` and `DISCORD_GUILD_ID` set, restart bot:

```powershell
npm start
```

Manual deploy (always valid):

```powershell
npm run deploy
```

## 9) Permissions Checklist

Bot needs in target channel:

- `View Channel`
- `Send Messages`
- `Embed Links`
- `Read Message History` (recommended)

If publish fails, check channel-level permission overrides, not only role defaults.

## 10) Troubleshooting

### `401 Unauthorized` or `TokenInvalid`

- `DISCORD_TOKEN` is wrong (often OAuth2 Client Secret instead of Bot token)
- Reset/copy token from `Developer Portal -> Bot`

### Bot appears in Integrations but not Members

- Re-invite with `bot` + `applications.commands` scopes
- Remove old integration first, then invite again

### Slash commands missing after re-adding bot

```powershell
npm run deploy
```

Then refresh Discord client (`Ctrl+R`).

### `Missing Access` / cannot post in channel

- Bot lacks permission in that channel
- Add explicit allow in channel permission overrides

## 11) Project Docs

- Main setup quickstart: [../README.md](../README.md)
- Token-focused guide: [../TOKENS.md](../TOKENS.md)
