# Button-Grid Calendar Setup View — Design Spec

**Date:** 2026-05-26
**Status:** Draft — awaiting user review
**Scope:** Replace the two StringSelectMenu dropdowns in the `/datepoll` setup view with a clickable button grid using Discord's Components V2 message flag. Voting view (post-publish poll message) is **out of scope** for this iteration.

---

## 1. Goal

Make the date-picking experience in `/datepoll` feel like clicking days on a calendar instead of opening dropdowns. The setup view should remain a single ephemeral message in the same channel — no external web app, no Discord Activity, no new window.

A "live summary" of selected dates should sit above the grid so the user can see what they've picked without scrolling or memorizing.

## 2. Non-goals

- The published poll's voting UI stays on StringSelectMenus. Re-thinking the voter experience is a separate spec.
- No weekday (Mon–Sun) column alignment. Discord ActionRows are hard-capped at 5 buttons, so a real 7-column grid is impossible without an external app.
- No "previous" navigation. The rolling window always starts at "today" and only moves forward.
- No timezone handling changes. Existing `dateKey`/`dateLabel` behavior in [`src/date-utils.js`](../../../src/date-utils.js) is preserved.
- No persistence-schema migration. Existing `data/sessions.json` and `data/polls.json` shapes still work; only fields used by the setup view change semantics.

## 3. User flow

1. User runs `/datepoll title:<text>`.
2. Bot replies with an ephemeral message containing:
   - A text block showing the title and a live summary of selected dates.
   - A 6×5 grid of day buttons (30 buttons) starting at today.
   - A control row with `Show more →` and `Publish (N)`.
3. User clicks day buttons. Each click toggles the date in the selection. Selected buttons change from `Secondary` (grey) to `Success` (green) style. The summary text re-renders to reflect the new selection.
4. User can click `Show more →` to slide the window forward by 30 days. The window has no upper bound enforced by the bot, but Discord's interaction lifetime (15 min) effectively caps it.
5. When at least one date is selected, `Publish` is enabled. Clicking it creates the poll in the channel using the existing publish path. The ephemeral setup message is replaced with "Poll published."
6. To cancel, the user uses Discord's built-in ephemeral "Dismiss message" action. No in-component Cancel button.

## 4. Layout details

The message uses the `IS_COMPONENTS_V2` flag (`1 << 15 = 32768`). This disables `content`, `embeds`, `stickers`, and `poll` fields — all text now lives in `TextDisplay` components.

```text
+----------------------------------------------------------+
| TextDisplay                                              |
| **<title>**                                              |
| 3 dates selected — Mon Jan 6, Tue Jan 7, Wed Jan 8       |
+----------------------------------------------------------+
| [  6 ][  7 ][  8 ][  9 ][ 10 ]                           |  row 1
| [ 11 ][ 12 ][ 13 ][ 14 ][ 15 ]                           |  row 2
| [ 16 ][ 17 ][ 18 ][ 19 ][ 20 ]                           |  row 3
| [ 21 ][ 22 ][ 23 ][ 24 ][ 25 ]                           |  row 4
| [ 26 ][ 27 ][ 28 ][ 29 ][ 30 ]                           |  row 5
| [ 31 ][  1 ][  2 ][  3 ][  4 ]                           |  row 6 (rolls across month boundary)
| [ Show more → ][ Publish (3) ]                           |  row 7
+----------------------------------------------------------+
```

### 4.1 Button labels

Standard day button label format: two-letter weekday + space + day-of-month. Examples: `Mo 6`, `Tu 7`, `Su 12`. Weekday tokens: `Mo`, `Tu`, `We`, `Th`, `Fr`, `Sa`, `Su`. This gives weekday context even without 7-column alignment.

**Exception — month boundary cells.** When a button represents day 1 of a new month within the window, the label switches to three-letter month + space + `1` (no weekday): `Feb 1`, `Mar 1`, `Jan 1`. The user just needs to know "we crossed into February" at that point; the weekday is less useful for the boundary marker than the month name.

All labels fit comfortably under Discord's 80-character button-label cap.

### 4.2 Button styles

- Unselected day: `ButtonStyle.Secondary` (grey).
- Selected day: `ButtonStyle.Success` (green).
- `Show more →`: `ButtonStyle.Secondary`.
- `Publish (N)`: `ButtonStyle.Primary` (blurple), disabled when `N === 0`.

### 4.3 Summary text rules

The `TextDisplay` shows two lines:

1. **Line 1**: `**<session title>**` — exact user title, markdown-bold.
2. **Line 2**:
   - When 0 dates selected: `_No dates selected yet — tap a day to add it._`
   - When 1–6 selected: `<N> date(s) selected — <comma-separated list using existing dateLabel()>`.
   - When 7+ selected: `<N> dates selected — <first 5 labels>, +<N-5> more`.

The cap at 5 prevents the TextDisplay from growing past a sensible read height. Discord caps TextDisplay at 4 000 characters; we stay well under.

## 5. Component count (the 40-cap accounting)

Components V2 caps a single message at **40 total components**. Every ActionRow and every button counts as 1.

| Element | Count |
| --- | --- |
| 1 × TextDisplay (title + summary) | 1 |
| 6 × ActionRow (day grid) | 6 |
| 30 × Day button | 30 |
| 1 × ActionRow (controls) | 1 |
| 2 × Control button (`Show more →`, `Publish`) | 2 |
| **Total** | **40** |

Exactly at the cap. Adding a Cancel button or a Prev-window button would push it over. Cancel is delegated to Discord's ephemeral dismiss; Prev is dropped because the window starts at today.

## 6. State model

### 6.1 Session shape changes

The existing `session` object in [`src/polls.js`](../../../src/polls.js) gains one field and changes the semantics of others:

| Field | Before | After |
| --- | --- | --- |
| `selectedDates: Set<string>` | dates picked via dropdown | unchanged — dates picked via buttons |
| `visibleMonth: Date` | first-of-month anchor | **deprecated**, kept on disk for backward-load compatibility but ignored by the new view |
| `monthOffset: number` | 0 or 1 | **deprecated**, same as above |
| `windowStart: string` (new) | — | ISO date key (`YYYY-MM-DD`) of the first cell visible in the grid; defaults to today's key on session creation |

`createSetupSession` initializes `windowStart` to `dateKey(today)`. Existing on-disk sessions without `windowStart` fall back to today on load. The deprecated fields are left untouched to avoid breaking any half-finished poll setups during deploy; they can be removed in a follow-up cleanup once `data/sessions.json` has rotated.

### 6.2 Window math

Given `windowStart = "YYYY-MM-DD"`, the 30 visible day keys are `addDays(parseDateKey(windowStart), i)` for `i = 0..29`. `addDays` is a new helper in `src/date-utils.js` alongside `addMonths`. `Show more →` does `windowStart = dateKey(addDays(parseDateKey(windowStart), 30))`.

Already-selected dates outside the current window are **kept in `selectedDates`** and appear in the summary text. They are not visible as buttons until the window slides back over them. Since the window only moves forward, a user can select a date, scroll forward, and the prior selection still counts at publish time — they just can't unselect it without restarting `/datepoll`. This is an acceptable trade-off given the no-prev-nav constraint; a follow-up could add an "Unselect older" overflow if it bites in practice.

## 7. Interaction handling

The existing setup-handler in [`src/index.js`](../../../src/index.js) (`handleSetupInteraction`) handles five action types today: `days-a` / `days-b` (select menus), `prev` / `next` (month nav), `publish`, `cancel`. The new view needs three actions:

| customId suffix | Trigger | Effect |
| --- | --- | --- |
| `day:<dateKey>` | Day button click | Toggle `dateKey` in `session.selectedDates`. Re-render the message via `interaction.update`. |
| `more` | `Show more →` click | Advance `session.windowStart` by 30 days. Re-render. |
| `publish` | `Publish` click | Existing publish path (`createPoll` + post to channel). No change. |

`days-a`, `days-b`, `prev`, `next`, `cancel` handlers are deleted. The `setupCustomId` builder gains a new shape: `datesetup:<sessionId>:day:<dateKey>` for day buttons, `datesetup:<sessionId>:more` and `datesetup:<sessionId>:publish` for controls. The colon-split parser in `handleSetupInteraction` must handle the 4-segment day case in addition to 3-segment control cases.

### 7.1 Idempotency

Day-button toggles are pure XOR against `selectedDates`. If Discord retries an interaction (rare but possible), a double-click results in the original state — undesirable but no worse than the current dropdown behavior, and recoverable by clicking again.

## 8. File-level impact

| File | Change |
| --- | --- |
| [`src/components.js`](../../../src/components.js) | Rewrite `createSetupRows` to emit the V2 grid + control row + TextDisplay. Remove `createDaySelect` (unused). `createPollRows` (voting view) untouched. |
| [`src/date-utils.js`](../../../src/date-utils.js) | Add `addDays(date, n)` helper. `renderCalendar` (ASCII calendar) is no longer used by the setup view; keep it for now in case the voting view wants it later, mark with a one-line `// kept for poll embed` comment. |
| [`src/polls.js`](../../../src/polls.js) | `createSetupSession` writes `windowStart`. `loadSessions` defaults `windowStart` to today's key when missing. `visibleMonth` / `monthOffset` reads tolerated, writes ignored. |
| [`src/index.js`](../../../src/index.js) | `handleDatePollCommand`: send with `flags: MessageFlags.IsComponentsV2 \| MessageFlags.Ephemeral`. `handleSetupInteraction`: replace action switch with the three-action set above. `createSetupEmbed` is deleted; its TextDisplay replacement lives in `components.js`. |

No new dependencies. discord.js v14.15.3 (current) supports Components V2 builders (`TextDisplayBuilder`).

## 9. Edge cases and error handling

- **Session expired**: Existing behavior — bot replies ephemerally that the session expired. Unchanged.
- **User other than session owner clicks a button**: Existing owner-check stays; bot replies ephemerally. Unchanged.
- **Discord rejects V2 flag** (e.g., older API endpoint): Should not happen on discord.js 14.15+. If it does, the bot logs and surfaces an error reply. Building a runtime fallback to the old dropdown view is out of scope; treat as a deploy-time verification step.
- **Publish to channel fails with 50001/50013**: Existing handling stays — ephemeral "I can't post in that channel" message.
- **Selected date drifts into the past**: Possible if a user opens setup near midnight, sits on it, and `today` rolls over. Acceptable. Publish still includes the date; the poll lists it.

## 10. Testing strategy

This project has no test suite today. Per the project rule (80% coverage minimum), introducing one is a separate effort, but for this change the bare minimum is:

1. **Manual smoke test in a dev Discord server**: select 3 dates spanning a month boundary, click `Show more`, verify summary updates, publish, verify poll posts with the right dates.
2. **Unit test (new)**: `src/date-utils.test.js` covering `addDays` (positive `n`, month-boundary, year-boundary, leap-day Feb 29 → Mar 1).
3. **Unit test (new)**: `src/components.test.js` asserting `createSetupRows` returns exactly 8 top-level components (1 TextDisplay + 6 grid ActionRows + 1 control ActionRow) and exactly 32 buttons total, regardless of how many days are selected.

`node --test` is sufficient — no new test framework needed. Adding this is part of the implementation plan, not optional cleanup.

## 11. Rollout

Single commit, single deploy. Old `data/sessions.json` entries load with `windowStart` defaulted; the deprecated `visibleMonth` / `monthOffset` fields are tolerated. No migration script required. Slash command shape is unchanged so `npm run deploy` is not strictly needed, though running it on first deploy doesn't hurt.

## 12. Open question (to flag before implementation)

The `Show more →` window only moves forward. If a user wants to pick dates that span 60+ days out and overshoots, they cannot scroll back without restarting `/datepoll` and losing existing selections. Two ways to handle this surface in the implementation plan:

- **(a)** Accept the limitation for v1. Add an "Unselect older" overflow button later if it bites.
- **(b)** Add a `← Earlier` button by removing one day button from row 6 (29 days visible instead of 30). Loses one cell but enables two-way nav.

Default: **(a)**. Worth confirming before implementation starts.
