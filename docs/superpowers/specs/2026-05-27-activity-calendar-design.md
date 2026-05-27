# Discord Activity Calendar — Design Spec

**Date:** 2026-05-27
**Status:** Draft — awaiting user review
**Branch:** `feature/activity-calendar` (cut from `main`)
**Replaces:** the in-chat dropdown setup view of `/datepoll`. The post-publish voting view (embed + StringSelectMenu) is preserved unchanged.

---

## 1. Goal

Replace the existing in-chat ephemeral dropdown setup view of `/datepoll` with a Discord **Activity** — a small React web app rendered inside Discord's iframe panel. Users open the activity from a link button in the bot's slash-command response, pick dates on a real visual calendar (`react-day-picker`), and the bot publishes the resulting poll to the channel.

## 2. Non-goals

- **No app verification.** The Activity is for the user's personal Discord server only. Discord will show an "unverified app" warning on first launch, which is acceptable.
- **No backward compatibility with the dropdown picker.** The Activity is the only setup path on this branch. (The button-grid branch is preserved separately.)
- **No multi-language UI.** English only in v1.
- **No timezone configurability per user.** All dates are local-time on the user's server, same convention as `main`.
- **No public hosting of the frontend on a cloud provider.** Self-hosted on the user's own server behind Caddy.
- **No iOS/Android client-specific testing.** Discord Activities currently work best on desktop and web. Mobile support is a Discord platform concern, not ours.
- **No persistence migration.** The on-disk `data/sessions.json` shape from `main` gets new fields (`token`, `lastActiveAt`); legacy entries without them are dropped on load (the file is gitignored and small).

## 3. Architecture overview

```text
                         ┌──────────────────────┐
                         │  Discord Gateway     │
                         └──────────┬───────────┘
                                    │ websocket
                       ┌────────────▼─────────────┐
                       │  Bot Process (Node 20+)  │
                       │  src/index.js            │── gateway client
                       │  src/server.js           │── Hono on 127.0.0.1:3000
                       │  in-mem Maps (sessions,  │
                       │  polls) + disk JSON      │
                       └────────────▲─────────────┘
                                    │
                                    │ proxied: /api/*
                                    │
   Discord client ── iframe ────────┼──── Caddy (TLS, :443) ──── /var/www/datepoll/dist
   (Activity panel)                 │                              (React build)
                                    │
                                    └──── DuckDNS A record ──────┘
                                          datepoll.duckdns.org
```

- **Bot process** keeps its existing Discord Gateway connection for slash commands and channel writes. It adds a small Hono HTTP server bound to `127.0.0.1:3000` (localhost-only, never directly internet-exposed).
- **Caddy** terminates TLS on `:443`, serves the React static bundle from `/var/www/datepoll/dist`, and reverse-proxies `/api/*` to `127.0.0.1:3000`. Caddy handles Let's Encrypt cert issuance automatically.
- **React app** runs inside Discord's Activity iframe. It talks to the bot only via `/api/*` (relative URLs, same origin as the iframe).
- **DuckDNS** hosts a free dynamic-DNS A record for the subdomain so the cert can issue and Discord can reach the URL. The user picks the subdomain (suggestion: `datepoll.duckdns.org`).

The split between gateway client and HTTP API lives in the same Node process to keep state in-memory simple. If we ever need to scale, splitting becomes mechanical because the only shared state is the on-disk JSON files.

## 4. End-to-end user flow

1. User runs `/datepoll title:<text>`.
2. Bot's slash-command handler:
   - Creates a new setup session: `{ id, token, userId, channelId, title, selectedDates: [], lastActiveAt: now }`.
   - Persists to `data/sessions.json`.
   - Replies ephemerally with a single Discord Link Button labelled `Open Calendar →`. URL: `https://discord.com/activities/<APPLICATION_ID>?datepoll_token=<token>&channel_id=<channelId>`.
3. User clicks the button. Discord opens the Activity panel; the iframe loads `https://datepoll.duckdns.org/?datepoll_token=<token>` (Caddy serves the React app).
4. React app boot:
   - Reads `datepoll_token` from `window.location.search`.
   - Initializes `@discord/embedded-app-sdk` with the application's client ID.
   - Calls `discordSdk.ready()`.
   - Calls `discordSdk.commands.authorize({ scope: ["identify"] })` → receives an OAuth code.
   - POSTs the code to `/api/discord/token`. Backend exchanges code + client secret for an access token. Token is returned to the frontend.
   - Frontend sets `Authorization: Bearer <token>` on subsequent requests.
   - Fetches `GET /api/sessions/:token` → returns `{ title, selectedDates: string[] }` (or 404 if the session expired / wrong user).
5. App renders the calendar:
   - Title and "Publish Poll" button at the top.
   - `react-day-picker` in multi-select mode, with month navigation.
   - Selected dates pre-highlighted from the fetched state.
6. Each date click triggers `POST /api/sessions/:token/toggle { dateKey: "YYYY-MM-DD" }`. Backend toggles XOR in `session.selectedDates`, persists, returns the new selection. Frontend updates its local state from the response (single source of truth: backend).
7. When the user clicks **Publish Poll**:
   - Frontend POSTs `/api/sessions/:token/publish` (no body required — server already has the dates).
   - Backend validates the token, validates ownership, runs `publishPoll(session)`:
     - Creates a `Poll` record using existing `createPoll` from `polls.js`.
     - Posts the poll embed + StringSelectMenu voting view to the original channel via `client.channels.fetch(session.channelId).send(...)`.
     - Deletes the session.
   - Backend responds `{ ok: true, channelId, messageId }`.
   - Frontend shows a "Poll published!" screen for 2 seconds, then calls `discordSdk.close()`.
8. In the text channel, the public poll appears. Voting works exactly as on `main`.

## 5. Discord Developer Portal setup

The user performs these manually before deploy. The implementation plan will surface them as a checklist.

| Step | Action |
| --- | --- |
| Enable Activities | App settings → Activities → Enable |
| Activity Shelf metadata | Icon (512×512 PNG), title `DatePoll`, short description |
| URL Mappings | Root `/` → `datepoll.duckdns.org` |
| OAuth2 scopes | Bot: `bot`, `applications.commands`. Activity uses: `identify` (requested at runtime via SDK) |
| Client Secret | Copy from OAuth2 → General → `Reset Secret`, store in `.env` as `DISCORD_CLIENT_SECRET` |
| Bot invite | Re-invite with the same scopes; permissions unchanged |

App verification is **skipped** by design. Users will see an "Unverified" badge on first launch — acceptable for personal use.

## 6. Server-side infrastructure

The user's server is bare; the plan will include setup steps. Target: a Linux box (assumed Debian/Ubuntu) with sudo access. The implementation plan covers the full setup procedure.

### 6.1 DNS

DuckDNS:

- Sign in with GitHub/Google at `https://www.duckdns.org/`.
- Reserve a subdomain (e.g., `datepoll`).
- Point it at the server's public IPv4.
- Configure auto-update if the IP is dynamic: a 5-min cron running their curl one-liner.

### 6.2 Caddy

`Caddyfile` (lives at `/etc/caddy/Caddyfile`):

```caddy
datepoll.duckdns.org {
  root * /var/www/datepoll/dist
  encode gzip
  try_files {path} /index.html
  file_server

  handle /api/* {
    reverse_proxy 127.0.0.1:3000
  }
}
```

Caddy obtains TLS certs from Let's Encrypt automatically. Inbound TCP 80 (briefly, for the ACME challenge) and 443 must be open. The `try_files {path} /index.html` line is required so React Router (if we add it) serves the SPA on deep links; right now the app is a single page, so it's harmless either way.

### 6.3 Process supervisor

Either:

- `pm2 start npm --name datepoll -- start` (+ `pm2 save`, `pm2 startup`), OR
- A `systemd` unit file under `/etc/systemd/system/datepoll.service` with `ExecStart=/usr/bin/npm start`.

The plan will prescribe systemd — it's the standard init system on Debian/Ubuntu and avoids adding pm2 as another moving part. If the box turns out not to have systemd for some reason, the plan can swap in pm2 mechanically.

### 6.4 Environment variables

`.env` additions on top of the existing set:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...    # NEW
DISCORD_GUILD_ID=...
PUBLIC_URL=https://datepoll.duckdns.org   # NEW (used to build the Link Button URL)
API_PORT=3000                              # NEW (default 3000)
AUTO_DEPLOY_COMMANDS=true
```

## 7. Bot HTTP API surface

The Hono server in `src/server.js` exposes four routes. All `/api/sessions/:token/*` routes require `Authorization: Bearer <discord-access-token>`.

| Route | Method | Body | Response | Notes |
| --- | --- | --- | --- | --- |
| `/api/health` | GET | — | `{ ok: true }` | No auth. For Caddy readiness check. |
| `/api/discord/token` | POST | `{ code: string }` | `{ access_token, expires_in }` | Server-side exchange of OAuth code for access token using `DISCORD_CLIENT_SECRET`. No auth required (the code itself is the credential). |
| `/api/sessions/:token` | GET | — | `{ title: string, selectedDates: string[] }` or 404 | Auth required. Validates that the token's session owner matches the Discord user behind the access token. |
| `/api/sessions/:token/toggle` | POST | `{ dateKey: string }` | `{ selectedDates: string[] }` | Auth + ownership. Toggles `dateKey` in `session.selectedDates`. Refreshes `lastActiveAt`. |
| `/api/sessions/:token/publish` | POST | — | `{ ok: true, channelId, messageId }` or `{ ok: false, error }` | Auth + ownership. Calls the existing `publishPoll` path. Deletes the session on success. |

### 7.1 Authentication mechanics

Each authenticated request:

1. Reads `Authorization: Bearer <token>` header.
2. Calls `GET https://discord.com/api/v10/users/@me` with that token.
3. Caches the result (token → userId) in an in-memory `Map` for the token's lifetime (10 min default).
4. Compares the resolved `userId` against `session.userId`. Mismatch → 403.

The Discord access token is short-lived (1h default) and tied to a single Discord user. The cache avoids hammering Discord's `/users/@me` on every toggle.

### 7.2 Session token

- 32 random bytes, base64url-encoded (~43 chars). Generated at session creation via `crypto.randomBytes(32).toString("base64url")`.
- Used as the path parameter on `/api/sessions/:token/...`.
- Also used as a URL query param `?datepoll_token=<token>` in the Link Button.
- The token IS the session capability — anyone with the token can interact with that session IF they pass the Discord-user ownership check. So even if the URL leaks, only the original creator can use it.

### 7.3 TTL & cleanup

Sliding-window rule: any successful auth-passing request to `/api/sessions/:token/*` refreshes `lastActiveAt`. A request to a session older than `SESSION_TTL_MS` (1 hour) returns 410 Gone. The frontend interprets 410 as "session expired" and shows a "This session expired — close this panel and run `/datepoll` again" screen.

A periodic sweep (every 15 min) deletes expired sessions from disk. Implementation: `setInterval` in `src/polls.js` calling a new `pruneExpiredSessions()`.

## 8. Frontend design

### 8.1 Stack

- **Vite** (`create-vite` template, React 18 + JS).
- **React 18** (no SSR; SPA only).
- **react-day-picker** for the calendar widget. Multi-select mode.
- **@discord/embedded-app-sdk** for in-Discord context and auth.
- **No additional state management library.** Plain `useState` / `useReducer`.
- **No CSS framework.** Hand-rolled CSS using CSS variables for theming (light/dark from Discord SDK).
- **No router.** Single page, single mode.

Target bundle: <200 KB gzipped. Realistic with the above stack.

### 8.2 Component tree

```text
<App>                          src/App.jsx
├── <DiscordProvider>          src/discord/DiscordProvider.jsx
│   └── (SDK init, auth flow, exposes { sdk, accessToken, userId } via context)
├── <SessionLoader>            src/session/SessionLoader.jsx
│   └── (fetches GET /api/sessions/:token, handles 410/403, exposes session state)
├── <Calendar>                 src/calendar/Calendar.jsx
│   └── (DayPicker wrapper, click handler dispatches toggle to backend)
├── <Summary>                  src/calendar/Summary.jsx
│   └── (shows selectedDates count + list)
├── <PublishButton>            src/publish/PublishButton.jsx
│   └── (POST /api/sessions/:token/publish, shows success screen)
└── <ErrorScreens>             src/errors/ErrorScreens.jsx
    └── (Expired / Forbidden / Network error variants)
```

### 8.3 State flow

The backend is the single source of truth for `selectedDates`. The frontend:

1. On mount, `GET /api/sessions/:token` populates initial `selectedDates`.
2. On every date click, optimistically updates local state, then `POST /toggle`, then reconciles with the server's response. If the POST fails, revert and show a toast.
3. On Publish click, locks the UI, `POST /publish`, on 200 → success screen → close.

Optimistic update prevents the calendar from feeling laggy on network round-trips.

### 8.4 Discord SDK lifecycle

```javascript
// src/discord/DiscordProvider.jsx (pseudocode)
const sdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

useEffect(() => {
  async function init() {
    await sdk.ready();
    const { code } = await sdk.commands.authorize({
      client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify"]
    });
    const res = await fetch("/api/discord/token", {
      method: "POST",
      body: JSON.stringify({ code }),
      headers: { "Content-Type": "application/json" }
    });
    const { access_token } = await res.json();
    setAccessToken(access_token);
  }
  init();
}, []);
```

### 8.5 Theming

The Discord SDK exposes the user's theme via `sdk.subscribe('ACTIVITY_LAYOUT_MODE_UPDATE', ...)` and initially via `sdk.config.theme`. We respect light/dark by toggling a CSS class on `<body>`. CSS variables (`--bg`, `--fg`, `--accent`) drive all colors. Default to dark mode.

### 8.6 Calendar UX details

- Multi-select mode (`mode="multiple"` in react-day-picker).
- Default month: current month.
- Past dates: greyed out, click ignored (date pickers shouldn't allow picking yesterday).
- Footer: "X dates selected" + `Publish Poll` button (disabled when 0 selected).
- Header: poll title (read-only).

## 9. Data model & persistence

### 9.1 Session shape

```javascript
{
  id: "uuid",                       // unchanged from main
  token: "base64url-32-bytes",      // NEW: capability token for API access
  userId: "snowflake",              // unchanged
  channelId: "snowflake",           // unchanged
  title: "string",                  // unchanged
  selectedDates: ["YYYY-MM-DD"],    // unchanged (Set in memory, array on disk)
  lastActiveAt: 1234567890000       // NEW: epoch ms, refreshed on every API hit
}
```

The legacy `main` fields `startMonth`, `visibleMonth`, `monthOffset`, `dayPage` are NOT carried over. They were specific to the dropdown view that no longer exists.

### 9.2 Poll shape

Unchanged from `main`. The voting view is preserved as-is.

### 9.3 File format

`data/sessions.json` and `data/polls.json` keep their JSON-array shape. New sessions write `token` and `lastActiveAt`. Legacy entries (if any from a previous deploy) without these fields fall back to: `token` regenerated, `lastActiveAt: Date.now()`.

## 10. Project structure

```text
datepoll/
├── src/                                # bot (Node, ESM)
│   ├── index.js                        # gateway client, slash handlers
│   ├── server.js                       # NEW: Hono HTTP API
│   ├── commands.js                     # /datepoll registration (unchanged shape)
│   ├── polls.js                        # session/poll persistence (extended)
│   ├── voting.js                       # NEW: extracted createPollRows / createPollEmbed
│   ├── date-utils.js                   # unchanged
│   ├── discord-auth.js                 # NEW: token-exchange + /users/@me cache
│   └── *.test.js                       # node --test
├── web/                                # NEW: React + Vite frontend
│   ├── index.html
│   ├── package.json                    # separate from root package.json
│   ├── vite.config.js
│   ├── public/
│   │   └── icon.svg
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api.js                      # fetch helpers, error handling
│       ├── discord/DiscordProvider.jsx
│       ├── session/SessionLoader.jsx
│       ├── calendar/Calendar.jsx
│       ├── calendar/Summary.jsx
│       ├── publish/PublishButton.jsx
│       ├── errors/ErrorScreens.jsx
│       └── styles.css
├── docs/superpowers/specs/
│   └── 2026-05-27-activity-calendar-design.md   # this file
└── data/                               # gitignored, runtime state
```

Two `package.json` files: the existing root one for the bot, and `web/package.json` for the React app. They don't share dependencies. Vite's build output goes to `web/dist/` and is deployed to `/var/www/datepoll/dist` on the server.

## 11. Local development workflow

Discord requires HTTPS even for development. Two viable approaches:

### Option A — Cloudflare Tunnel (recommended)

- `cloudflared tunnel` exposes `http://localhost:5173` (Vite dev server) as `https://<random>.trycloudflare.com`.
- Free, no DNS setup, instant TLS.
- Configure the Activity URL Mapping to point at this tunnel URL during dev (manually flip back before deploy).

### Option B — Local Caddy with self-signed cert

- Caddy runs locally; serves the React dev build over `https://localhost:8443`.
- Add the cert to the OS trust store.
- More setup. Use this if a tunnel isn't an option.

The plan will default to Option A and include the cloudflared install + run commands.

The Vite dev server proxies `/api/*` to `localhost:3000` via `vite.config.js` so the bot's HTTP API stays the same in dev and prod.

## 12. Deployment workflow

```bash
# On dev machine
cd web && npm run build
rsync -r web/dist/ <user>@<server>:/var/www/datepoll/dist/

# On server
cd /opt/datepoll
git pull
npm install
sudo systemctl restart datepoll
```

A small `scripts/deploy.sh` will codify this. First deploy includes:

- `sudo apt install caddy nodejs npm`
- `sudo mkdir -p /var/www/datepoll /opt/datepoll`
- Clone the repo into `/opt/datepoll`
- Drop the systemd unit
- Write the Caddyfile
- `sudo systemctl enable --now caddy datepoll`

## 13. Testing strategy

### 13.1 Bot unit tests (`node --test`)

- `src/polls.test.js`: session creation writes a unique `token`; `lastActiveAt` initializes; TTL expiry path.
- `src/server.test.js` (new): each Hono route — health (no auth), token exchange (mocked Discord API), GET session (auth + ownership), toggle (XOR semantics), publish (calls `createPoll` and `client.channels.fetch.send` — both stubbed via DI).
- `src/discord-auth.test.js`: token cache TTL, cache miss path, expired token rejection.

To enable testing without a real Discord client, `src/server.js` and `publishPoll` accept their Discord dependencies via parameters so tests inject fakes.

### 13.2 Frontend tests (Vitest)

- `Calendar.test.jsx`: selecting a date dispatches the expected toggle action.
- `SessionLoader.test.jsx`: 404 / 410 / 403 each render the correct error screen.
- `PublishButton.test.jsx`: disabled when 0 dates; shows success screen on 200; shows error toast on 400.

A small `web/vitest.config.js` enables jsdom-based component testing.

### 13.3 End-to-end smoke test

Manual, in a real Discord client (same pattern as the button-grid branch). Documented as the final task.

## 14. Security review

| Threat | Mitigation |
| --- | --- |
| Unauthorized user steals a session token from logs | Token is opaque (32 random bytes), but ownership check via Discord `/users/@me` blocks misuse even if it leaks. |
| Frontend impersonates another user | Ownership check on every authenticated route. Discord access tokens are tied to a single user. |
| Replay of OAuth code | Discord codes are single-use and short-lived; the exchange endpoint surfaces Discord's own errors verbatim. |
| Reverse-proxy bypass | Hono binds to `127.0.0.1:3000` only; only Caddy can reach it. No direct internet exposure. |
| Cert auto-renewal failure | Caddy logs to journald; a one-line monitor script can `journalctl -u caddy --since "1 day ago" \| grep ERROR` and alert. Out of scope for v1. |
| Stale sessions on disk | 1-hour TTL + periodic prune. |
| Embedded SDK URL spoofing | Same-origin policy: the frontend only makes requests to its own origin, served by our Caddy. |

`DISCORD_CLIENT_SECRET` is the most sensitive new credential. It must NEVER be sent to the frontend and must NEVER be committed to git. The plan will reinforce this.

## 15. Edge cases & error handling

- **Discord SDK fails to initialize** (e.g., Activity launched outside Discord client): frontend detects via `sdk.ready()` timeout (3s) → shows "Open this from Discord."
- **OAuth code exchange fails**: frontend shows "Couldn't authenticate with Discord. Close and try again."
- **Session not found / expired (410)**: frontend shows the "Session expired" screen with a button to close.
- **Wrong-user clicks the link** (e.g., the URL was shared in a public channel): owner check fails → 403 → "This calendar belongs to someone else."
- **Backend cannot post to channel** (50001/50013 permissions): publish endpoint returns `{ ok: false, error: "missing_permissions" }` → frontend shows "I can't post in that channel. Re-invite the bot with `View Channel` and `Send Messages`."
- **Network failure during toggle**: optimistic update is reverted; toast: "Couldn't save. Try again."
- **Toggle races**: server is authoritative; the response always reflects the canonical state. Last write wins per-key.

## 16. Rollout

- Single commit sequence on `feature/activity-calendar`, similar to the button-grid branch.
- No data migration (legacy fields are dropped on load; `data/sessions.json` is gitignored anyway).
- First deploy is a full setup: DuckDNS, Caddy, systemd, repo clone, frontend build, manual Developer Portal flips.
- Smoke test in dev guild before declaring done.

## 17. Open questions / acknowledged risks

1. **Discord Activity URL parameters.** The exact mechanism Discord uses to pass `?datepoll_token=` through to the iframe (vs stripping query strings) needs to be verified against the current Embedded App SDK docs during implementation. Fallback: the frontend authenticates via the SDK's `instanceId` + the bot tracks the most recent un-published session for the requesting user, instead of an explicit token.
2. **OAuth scope `identify`.** Sufficient for `/users/@me`. If Discord deprecates this in favor of a newer scope, the plan adapts.
3. **react-day-picker v9 vs v8.** The plan will pin v9 (current major) and lock the version.
4. **CSP / iframe sandbox.** Discord's Activity iframe has strict CSP. We need to test that our backend calls to Discord's API are listed in URL Mappings before they're allowed. Plan: declare any external hosts the frontend hits up front.
5. **Mobile.** Activities work best on desktop. Mobile fitness is platform-dependent. Acceptable.

## 18. Success criteria

- `/datepoll title:Smoke` posts an ephemeral with a single `Open Calendar →` link button.
- Clicking the button opens the Activity panel; the calendar loads in <2s on a warm cache.
- Selecting / deselecting dates updates the panel within ~100ms (optimistic) and persists to disk.
- Clicking Publish posts the same poll embed + StringSelect voting view in the originating channel; the activity panel shows a success screen and auto-closes after 2s.
- A second click on the same link button while the session is alive resumes the same selections.
- A click on a link button 1h+ later shows the "Session expired" screen.

## 19. Estimated scope

The implementation plan will decompose this into ~15 tasks. Rough size estimate:

- **Backend changes**: ~400 LOC new (Hono server, token cache, route handlers, tests).
- **Frontend**: ~600 LOC new (React app, components, styles, tests).
- **Infra & deploy scripts**: ~50 LOC config / shell.
- **Manual setup time** (server-side, Developer Portal): ~1 hour for a first-timer.

Compared to the button-grid refactor (~600 LOC total), this is roughly 2x the code and 5x the operational complexity. Most of the difficulty is in the Discord platform setup, not in the code itself.
