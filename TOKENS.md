# Discord Token Setup

This bot needs three values in `.env`.

Start from `.env.example`:

```powershell
copy .env.example .env
notepad .env
```

## DISCORD_TOKEN

This is the private bot token. Keep it secret.

Where to find it:

1. Open the Discord Developer Portal: https://discord.com/developers/applications
2. Select your application.
3. Open **Bot** in the left sidebar.
4. If there is no bot yet, click **Add Bot**.
5. Click **Reset Token** or **View Token**.
6. Copy the token into `.env`:

```env
DISCORD_TOKEN=paste-the-bot-token-here
```

Never commit this value. The `.gitignore` already excludes `.env`.

Important: do not use the **Client Secret** from **OAuth2** or **General Information**. That value is usually much shorter and will cause `401: Unauthorized` or `TokenInvalid`.

## DISCORD_CLIENT_ID

This is the application ID, also called client ID.

Where to find it:

1. Open the Discord Developer Portal: https://discord.com/developers/applications
2. Select your application.
3. Open **General Information** in the left sidebar.
4. Copy **Application ID**.
5. Put it into `.env`:

```env
DISCORD_CLIENT_ID=paste-the-application-id-here
```

## DISCORD_GUILD_ID

This is the server ID for your test Discord server.

Using a guild ID is recommended while developing because slash command updates appear almost instantly. Without it, commands are registered globally and can take up to an hour to update.

Where to find it:

1. Open Discord.
2. Go to **User Settings**.
3. Open **Advanced**.
4. Enable **Developer Mode**.
5. Right-click your server icon.
6. Click **Copy Server ID**.
7. Put it into `.env`:

```env
DISCORD_GUILD_ID=paste-the-server-id-here
```

## Example `.env`

```env
DISCORD_TOKEN=MTIz...
DISCORD_CLIENT_ID=123456789012345678
DISCORD_GUILD_ID=987654321098765432
```

## After Filling `.env`

Run these commands from the project folder:

```powershell
npm run deploy
npm start
```

The project folder is:

```text
C:\Users\Klemens\Repositories\Privat\Discord\datepoll
```
