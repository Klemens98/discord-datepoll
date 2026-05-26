# DatePoll Discord Bot

A small Discord bot that lets you create date polls from a Discord-native calendar setup view.

## Docs

- Full installation + server setup guide: [docs/INSTALLATION.md](docs/INSTALLATION.md)
- Token setup guide: [TOKENS.md](TOKENS.md)

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in:

   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID` for fast test-server command registration

   See [TOKENS.md](TOKENS.md) for where to find each value.

3. Register the slash command:

   ```powershell
   npm run deploy
   ```

   Tip: you can skip manual deploy while developing by enabling `AUTO_DEPLOY_COMMANDS` in `.env`.

4. Start the bot:

   ```powershell
   npm start
   ```

## Usage

Run `/datepoll title: "Team dinner"` in Discord.

The bot opens a private setup interface where you can:

- switch between the current month and next month,
- select multiple days from the full visible month,
- publish a public poll.

People vote by selecting one or more dates in the poll message. The bot updates the results in place.

## Auto Command Deploy (Dev)

If `DISCORD_GUILD_ID` is set, the bot auto-registers slash commands on startup by default.
You can override this behavior with:

```env
AUTO_DEPLOY_COMMANDS=true
```

or

```env
AUTO_DEPLOY_COMMANDS=false
```
