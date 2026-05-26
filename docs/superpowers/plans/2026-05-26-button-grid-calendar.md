# Button-Grid Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dropdown-based date picker in `/datepoll`'s ephemeral setup view with a clickable Components V2 button grid, with a live summary above and a `Show more →` / `Publish` control row below.

**Architecture:** The setup message switches to Discord's Components V2 (`flags |= IS_COMPONENTS_V2`, value `32768`). Layout is 1 TextDisplay + 6 ActionRows × 5 day buttons (30-day rolling window starting at today) + 1 control ActionRow (2 buttons). Total: exactly 40 components, Discord's V2 cap. Day buttons toggle dates via XOR on `session.selectedDates`; selected dates flip `ButtonStyle.Secondary` → `Success`. State machine lives in the existing in-memory `sessions` map + `data/sessions.json`, gaining a `windowStart` field.

**Tech Stack:** Node 18+ (currently 24.15.0), discord.js v14.26.4 (upgrading from v14.15.3 to get TextDisplay builder + `MessageFlags.IsComponentsV2`), Node's built-in `node --test` runner for unit tests, dotenv unchanged.

**Spec:** [docs/superpowers/specs/2026-05-26-button-grid-calendar-design.md](../specs/2026-05-26-button-grid-calendar-design.md)

---

## File Structure

**Modified:**
- `package.json` — bump `discord.js` to `^14.26.4`, add `"test": "node --test 'src/**/*.test.js'"` script.
- `src/date-utils.js` — add `addDays(date, n)`, `buttonDayLabel(dateKey)`. `renderCalendar` left in place (still used by the unchanged poll-embed code; the setup view no longer calls it).
- `src/components.js` — rewrite `createSetupRows(session)`, replace `setupCustomId` shape, add `parseSetupCustomId(customId)`, add `summaryLine(session)`. Remove `createDaySelect` (no longer used). `createPollRows` (voting view) untouched.
- `src/polls.js` — `createSetupSession` writes `windowStart`. `loadSessions` defaults `windowStart` to today's key when missing.
- `src/index.js` — `handleDatePollCommand` sends with `flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2` and no `embeds`. `handleSetupInteraction` parser updated for the new 3-action set (`day:<key>`, `more`, `publish`); old branches deleted. `createSetupEmbed` (private helper) deleted.

**Created:**
- `src/date-utils.test.js` — unit tests for `addDays`, `buttonDayLabel`.
- `src/components.test.js` — unit tests for `summaryLine`, `parseSetupCustomId`, `createSetupRows` (component-count + structure).

---

## Task 1: Wire up the test runner

**Files:**
- Modify: `package.json`
- Create: `src/sanity.test.js`

- [ ] **Step 1: Add `test` script to package.json**

Open `package.json` and edit the `scripts` block from:

```json
"scripts": {
  "start": "node src/index.js",
  "deploy": "node src/deploy-commands.js",
  "check-token": "node src/check-token.js"
}
```

to:

```json
"scripts": {
  "start": "node src/index.js",
  "deploy": "node src/deploy-commands.js",
  "check-token": "node src/check-token.js",
  "test": "node --test \"src/**/*.test.js\""
}
```

- [ ] **Step 2: Write a sanity test**

Create `src/sanity.test.js`:

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";

test("test runner is wired up", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Run it**

Run: `npm test`
Expected: 1 test passes. Output contains `# pass 1`.

- [ ] **Step 4: Delete the sanity test**

Delete `src/sanity.test.js`. It was scaffolding only.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: add node --test runner script"
```

---

## Task 2: Upgrade discord.js to ^14.26.4

**Files:**
- Modify: `package.json`, `package-lock.json` (auto)

- [ ] **Step 1: Bump the version**

In `package.json`, change:

```json
"discord.js": "^14.15.3"
```

to:

```json
"discord.js": "^14.26.4"
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: lockfile updates; no errors.

- [ ] **Step 3: Smoke-check that `MessageFlags.IsComponentsV2` exists**

Run from PowerShell at the repo root:

```powershell
node -e "import('discord.js').then(m => console.log('IsComponentsV2 =', m.MessageFlags.IsComponentsV2, '| TextDisplayBuilder =', typeof m.TextDisplayBuilder))"
```

Expected output: `IsComponentsV2 = 32768 | TextDisplayBuilder = function`

If either is missing, stop and reconsider — the rest of the plan assumes both exist on the discord.js version we ended up with.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade discord.js to ^14.26.4 for Components V2"
```

---

## Task 3: `addDays(date, n)` date helper

**Files:**
- Create: `src/date-utils.test.js`
- Modify: `src/date-utils.js`

- [ ] **Step 1: Write the failing tests**

Create `src/date-utils.test.js`:

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { addDays, dateKey } from "./date-utils.js";

test("addDays returns a new Date offset by n days", () => {
  const start = new Date(2026, 4, 26); // May 26, 2026
  const result = addDays(start, 1);
  assert.equal(dateKey(result), "2026-05-27");
});

test("addDays crosses month boundaries", () => {
  const start = new Date(2026, 4, 30); // May 30
  const result = addDays(start, 3);
  assert.equal(dateKey(result), "2026-06-02");
});

test("addDays crosses year boundaries", () => {
  const start = new Date(2026, 11, 30); // Dec 30, 2026
  const result = addDays(start, 5);
  assert.equal(dateKey(result), "2027-01-04");
});

test("addDays handles leap day (2028 is a leap year)", () => {
  const start = new Date(2028, 1, 28); // Feb 28, 2028
  const result = addDays(start, 1);
  assert.equal(dateKey(result), "2028-02-29");

  const past = addDays(start, 2);
  assert.equal(dateKey(past), "2028-03-01");
});

test("addDays does not mutate the input", () => {
  const start = new Date(2026, 4, 26);
  const snapshot = start.getTime();
  addDays(start, 10);
  assert.equal(start.getTime(), snapshot);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 5 failures. Errors mention `addDays is not a function` (or similar export error).

- [ ] **Step 3: Implement `addDays`**

Open `src/date-utils.js`. After the `addMonths` function (around line 20), add:

```javascript
export function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all 5 `addDays` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/date-utils.js src/date-utils.test.js
git commit -m "feat(date-utils): add addDays helper"
```

---

## Task 4: `buttonDayLabel(dateKey)` label helper

**Files:**
- Modify: `src/date-utils.js`, `src/date-utils.test.js`

`buttonDayLabel` produces the short string shown on a day button. Standard form: `Mo 6`, `Tu 7`. When the date is day 1 of a month, it switches to month-short form: `Feb 1`, `Mar 1`, `Jan 1`. (See spec §4.1.)

- [ ] **Step 1: Write the failing tests**

Append to `src/date-utils.test.js`:

```javascript
import { buttonDayLabel } from "./date-utils.js";

test("buttonDayLabel: weekday + day for normal cells", () => {
  // 2026-05-26 is a Tuesday
  assert.equal(buttonDayLabel("2026-05-26"), "Tu 26");
  // 2026-05-30 is a Saturday
  assert.equal(buttonDayLabel("2026-05-30"), "Sa 30");
});

test("buttonDayLabel: month-short + 1 on the first of a month", () => {
  assert.equal(buttonDayLabel("2026-06-01"), "Jun 1");
  assert.equal(buttonDayLabel("2027-01-01"), "Jan 1");
});

test("buttonDayLabel: weekday tokens are exactly 2 chars", () => {
  // 2026-05-31 is a Sunday
  assert.equal(buttonDayLabel("2026-05-31"), "Su 31");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 3 new failures. Error: `buttonDayLabel is not a function`.

- [ ] **Step 3: Implement `buttonDayLabel`**

Append to `src/date-utils.js`:

```javascript
const WEEKDAY_TOKENS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_TOKENS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export function buttonDayLabel(key) {
  const date = parseDateKey(key);
  const day = date.getDate();

  if (day === 1) {
    return `${MONTH_TOKENS[date.getMonth()]} 1`;
  }

  return `${WEEKDAY_TOKENS[date.getDay()]} ${day}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all `buttonDayLabel` tests pass. The existing `addDays` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/date-utils.js src/date-utils.test.js
git commit -m "feat(date-utils): add buttonDayLabel helper"
```

---

## Task 5: `summaryLine(session)` helper

**Files:**
- Create: `src/components.test.js`
- Modify: `src/components.js`

`summaryLine` produces the second line of the TextDisplay summary block. Behavior (spec §4.3):

- 0 selected → `_No dates selected yet — tap a day to add it._`
- 1–6 selected → `<N> date(s) selected — <comma-joined dateLabel values>`
- 7+ selected → `<N> dates selected — <first 5 labels>, +<N-5> more`

Order of selected dates in the summary: chronological (sorted ascending by dateKey).

- [ ] **Step 1: Write the failing tests**

Create `src/components.test.js`:

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { summaryLine } from "./components.js";

function sessionWith(keys) {
  return { selectedDates: new Set(keys) };
}

test("summaryLine: 0 selected shows hint", () => {
  const line = summaryLine(sessionWith([]));
  assert.equal(line, "_No dates selected yet — tap a day to add it._");
});

test("summaryLine: 1 selected uses singular", () => {
  const line = summaryLine(sessionWith(["2026-05-26"]));
  assert.match(line, /^1 date selected —/);
  assert.match(line, /Tue, May 26$/);
});

test("summaryLine: 6 selected lists all of them, comma-joined", () => {
  const keys = [
    "2026-05-26", "2026-05-27", "2026-05-28",
    "2026-05-29", "2026-05-30", "2026-05-31"
  ];
  const line = summaryLine(sessionWith(keys));
  assert.match(line, /^6 dates selected —/);
  assert.ok(line.includes("Tue, May 26, Wed, May 27"));
  assert.ok(line.endsWith("Sun, May 31"));
});

test("summaryLine: 7 selected shows first 5 then +N more", () => {
  const keys = [
    "2026-05-26", "2026-05-27", "2026-05-28",
    "2026-05-29", "2026-05-30", "2026-05-31",
    "2026-06-01"
  ];
  const line = summaryLine(sessionWith(keys));
  assert.match(line, /^7 dates selected —/);
  assert.ok(line.includes("Tue, May 26"));
  assert.ok(line.includes("+2 more"));
  assert.ok(!line.includes("May 31"));
});

test("summaryLine: unordered input is sorted chronologically", () => {
  const line = summaryLine(sessionWith(["2026-05-30", "2026-05-26", "2026-05-28"]));
  const may26Index = line.indexOf("May 26");
  const may28Index = line.indexOf("May 28");
  const may30Index = line.indexOf("May 30");
  assert.ok(may26Index < may28Index);
  assert.ok(may28Index < may30Index);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 5 new failures with `summaryLine is not a function` or import error.

- [ ] **Step 3: Implement `summaryLine`**

Open `src/components.js`. Make sure the top-of-file import includes `dateLabel` (it already does). Then add the new function at the bottom of the file:

```javascript
export function summaryLine(session) {
  const count = session.selectedDates.size;

  if (count === 0) {
    return "_No dates selected yet — tap a day to add it._";
  }

  const sortedKeys = [...session.selectedDates].sort();
  const labels = sortedKeys.map((key) => dateLabel(key));
  const noun = count === 1 ? "date" : "dates";

  if (count <= 6) {
    return `${count} ${noun} selected — ${labels.join(", ")}`;
  }

  const shown = labels.slice(0, 5).join(", ");
  const remaining = count - 5;
  return `${count} ${noun} selected — ${shown}, +${remaining} more`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all `summaryLine` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components.js src/components.test.js
git commit -m "feat(components): add summaryLine helper for setup view"
```

---

## Task 6: `parseSetupCustomId(customId)` parser

**Files:**
- Modify: `src/components.js`, `src/components.test.js`

The new customId shapes (spec §7):

- `datesetup:<sessionId>:day:<dateKey>` — day toggle
- `datesetup:<sessionId>:more` — slide window
- `datesetup:<sessionId>:publish` — publish

`<dateKey>` itself contains hyphens but **no colons**, so colon-split parsing is safe.

- [ ] **Step 1: Write the failing tests**

Append to `src/components.test.js`:

```javascript
import { parseSetupCustomId } from "./components.js";

test("parseSetupCustomId: day action carries dateKey", () => {
  const result = parseSetupCustomId("datesetup:abc-123:day:2026-05-26");
  assert.deepEqual(result, {
    sessionId: "abc-123",
    action: "day",
    dateKey: "2026-05-26"
  });
});

test("parseSetupCustomId: more action has no dateKey", () => {
  const result = parseSetupCustomId("datesetup:abc-123:more");
  assert.deepEqual(result, {
    sessionId: "abc-123",
    action: "more",
    dateKey: null
  });
});

test("parseSetupCustomId: publish action has no dateKey", () => {
  const result = parseSetupCustomId("datesetup:abc-123:publish");
  assert.deepEqual(result, {
    sessionId: "abc-123",
    action: "publish",
    dateKey: null
  });
});

test("parseSetupCustomId: returns null for foreign prefixes", () => {
  assert.equal(parseSetupCustomId("datepoll:abc:0"), null);
  assert.equal(parseSetupCustomId("nonsense"), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 4 new failures with `parseSetupCustomId is not a function`.

- [ ] **Step 3: Replace `setupCustomId` and add `parseSetupCustomId`**

In `src/components.js`, replace the existing `setupCustomId` function with the version below, and add `parseSetupCustomId` immediately after it:

```javascript
export function setupCustomId(sessionId, action, dateKey = null) {
  if (action === "day") {
    if (!dateKey) {
      throw new Error("setupCustomId: 'day' action requires a dateKey");
    }
    return `${SETUP_PREFIX}:${sessionId}:day:${dateKey}`;
  }
  return `${SETUP_PREFIX}:${sessionId}:${action}`;
}

export function parseSetupCustomId(customId) {
  const segments = customId.split(":");
  if (segments[0] !== SETUP_PREFIX) {
    return null;
  }
  const [, sessionId, action, dateKey] = segments;
  if (!sessionId || !action) {
    return null;
  }
  return {
    sessionId,
    action,
    dateKey: dateKey ?? null
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all `parseSetupCustomId` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components.js src/components.test.js
git commit -m "feat(components): version setup customId for day/more/publish actions"
```

---

## Task 7: Rewrite `createSetupRows(session)` for the V2 button grid

**Files:**
- Modify: `src/components.js`, `src/components.test.js`

`createSetupRows` becomes the heart of the new view. It returns an array of 8 top-level components: 1 TextDisplay + 6 day-grid ActionRows + 1 control ActionRow. Total 40 components when counting every button.

- [ ] **Step 1: Write the failing tests**

Append to `src/components.test.js`:

```javascript
import { createSetupRows } from "./components.js";
import { dateKey } from "./date-utils.js";

function sessionFromToday({ selected = [] } = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    id: "abc-123",
    title: "Movie Night",
    windowStart: dateKey(today),
    selectedDates: new Set(selected)
  };
}

test("createSetupRows: returns exactly 8 top-level components", () => {
  const rows = createSetupRows(sessionFromToday());
  assert.equal(rows.length, 8);
});

test("createSetupRows: first component is a TextDisplay (type 10)", () => {
  const rows = createSetupRows(sessionFromToday());
  const first = rows[0].toJSON ? rows[0].toJSON() : rows[0];
  assert.equal(first.type, 10);
  assert.ok(first.content.includes("Movie Night"));
});

test("createSetupRows: 6 day-grid ActionRows hold 30 buttons total", () => {
  const rows = createSetupRows(sessionFromToday());
  const dayRows = rows.slice(1, 7).map((r) => (r.toJSON ? r.toJSON() : r));
  const totalDayButtons = dayRows.reduce(
    (acc, row) => acc + row.components.length,
    0
  );
  assert.equal(dayRows.length, 6);
  assert.equal(totalDayButtons, 30);
});

test("createSetupRows: control row has Show more + Publish buttons", () => {
  const rows = createSetupRows(sessionFromToday());
  const controlRow = rows[7].toJSON ? rows[7].toJSON() : rows[7];
  assert.equal(controlRow.components.length, 2);
  const labels = controlRow.components.map((c) => c.label);
  assert.deepEqual(labels, ["Show more →", "Publish (0)"]);
});

test("createSetupRows: Publish is disabled when no dates selected", () => {
  const rows = createSetupRows(sessionFromToday());
  const controlRow = rows[7].toJSON ? rows[7].toJSON() : rows[7];
  const publishBtn = controlRow.components[1];
  assert.equal(publishBtn.disabled, true);
});

test("createSetupRows: Publish is enabled and shows count when dates selected", () => {
  const session = sessionFromToday({ selected: ["2099-01-01", "2099-01-02"] });
  const rows = createSetupRows(session);
  const controlRow = rows[7].toJSON ? rows[7].toJSON() : rows[7];
  const publishBtn = controlRow.components[1];
  assert.equal(publishBtn.label, "Publish (2)");
  assert.ok(publishBtn.disabled === false || publishBtn.disabled === undefined);
});

test("createSetupRows: selected days within the window use Success style", () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = dateKey(today);
  const session = {
    id: "abc-123",
    title: "Lunch",
    windowStart: todayKey,
    selectedDates: new Set([todayKey])
  };
  const rows = createSetupRows(session);

  let matched = null;
  for (let i = 1; i <= 6; i++) {
    const row = rows[i].toJSON ? rows[i].toJSON() : rows[i];
    for (const btn of row.components) {
      if (btn.custom_id?.endsWith(`:day:${todayKey}`)) {
        matched = btn;
        break;
      }
    }
    if (matched) break;
  }

  assert.ok(matched, "Today's button must exist in the grid");
  // ButtonStyle.Success === 3
  assert.equal(matched.style, 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 7 new failures — the current `createSetupRows` returns the old dropdown structure (`days-a` / `days-b`).

- [ ] **Step 3: Rewrite `createSetupRows` and update imports**

Open `src/components.js`. Replace the top-of-file import block with:

```javascript
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  TextDisplayBuilder
} from "discord.js";
import { addDays, buttonDayLabel, dateKey, dateLabel, parseDateKey } from "./date-utils.js";
```

`StringSelectMenuBuilder` is kept because `createPollRows` (voting view) still uses it. `getMonthDays` import (if present) is removed.

Below `setupCustomId` / `parseSetupCustomId`, add the constant and rewrite `createSetupRows`:

```javascript
const WINDOW_SIZE = 30;

export function createSetupRows(session) {
  const startDate = parseDateKey(session.windowStart);
  const windowKeys = Array.from({ length: WINDOW_SIZE }, (_, i) =>
    dateKey(addDays(startDate, i))
  );

  const components = [];

  components.push(
    new TextDisplayBuilder().setContent(
      `**${session.title}**\n${summaryLine(session)}`
    )
  );

  for (let row = 0; row < 6; row++) {
    const rowKeys = windowKeys.slice(row * 5, row * 5 + 5);
    components.push(
      new ActionRowBuilder().addComponents(
        rowKeys.map((key) =>
          new ButtonBuilder()
            .setCustomId(setupCustomId(session.id, "day", key))
            .setLabel(buttonDayLabel(key))
            .setStyle(
              session.selectedDates.has(key)
                ? ButtonStyle.Success
                : ButtonStyle.Secondary
            )
        )
      )
    );
  }

  const count = session.selectedDates.size;
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(setupCustomId(session.id, "more"))
        .setLabel("Show more →")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(setupCustomId(session.id, "publish"))
        .setLabel(`Publish (${count})`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(count === 0)
    )
  );

  return components;
}
```

Remove the old `createDaySelect` function entirely (it is no longer referenced).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all `createSetupRows` tests pass. All previous tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/components.js src/components.test.js
git commit -m "feat(components): rewrite createSetupRows as Components V2 button grid"
```

---

## Task 8: Update session shape (`windowStart` field) in `polls.js`

**Files:**
- Modify: `src/polls.js`
- Create: `src/polls.test.js`

The session in memory gains a `windowStart` field (a `YYYY-MM-DD` string). On `createSetupSession` it defaults to today. On disk-load, sessions missing `windowStart` default to today as well, so older `data/sessions.json` files load without crashing.

- [ ] **Step 1: Write the failing tests**

Create `src/polls.test.js`:

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createSetupSession, getSetupSession, deleteSetupSession } from "./polls.js";
import { dateKey } from "./date-utils.js";

test("createSetupSession initializes windowStart to today's key", () => {
  const session = createSetupSession({
    userId: "u1",
    channelId: "c1",
    title: "Test"
  });

  const todayKey = dateKey(new Date());
  assert.equal(session.windowStart, todayKey);

  deleteSetupSession(session.id);
});

test("getSetupSession returns the same session object", () => {
  const session = createSetupSession({
    userId: "u1",
    channelId: "c1",
    title: "Test"
  });
  const fetched = getSetupSession(session.id);
  assert.equal(fetched, session);

  deleteSetupSession(session.id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 1 failure — `createSetupSession` does not yet set `windowStart`. The second test should already pass.

- [ ] **Step 3: Update `createSetupSession`**

In `src/polls.js`, modify `createSetupSession`. Current shape:

```javascript
export function createSetupSession({ userId, channelId, title }) {
  const id = crypto.randomUUID();
  const startMonth = new Date();
  startMonth.setDate(1);
  startMonth.setHours(0, 0, 0, 0);

  const session = {
    id,
    userId,
    channelId,
    title,
    startMonth,
    visibleMonth: new Date(startMonth),
    monthOffset: 0,
    dayPage: 0,
    selectedDates: new Set()
  };

  sessions.set(id, session);
  saveSessions();
  return session;
}
```

Replace with:

```javascript
export function createSetupSession({ userId, channelId, title }) {
  const id = crypto.randomUUID();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const session = {
    id,
    userId,
    channelId,
    title,
    windowStart: dateKey(today),
    selectedDates: new Set()
  };

  sessions.set(id, session);
  saveSessions();
  return session;
}
```

Add `dateKey` to the import at the top of `polls.js`. Replace:

```javascript
import { dateLabel } from "./date-utils.js";
```

with:

```javascript
import { dateKey, dateLabel } from "./date-utils.js";
```

- [ ] **Step 4: Update `loadSessions` to default `windowStart` for legacy entries**

Modify the `loadSessions` function in `src/polls.js`. Current shape:

```javascript
function loadSessions() {
  if (!existsSync(SESSIONS_FILE)) {
    return;
  }

  const savedSessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));

  for (const savedSession of savedSessions) {
    sessions.set(savedSession.id, {
      ...savedSession,
      startMonth: new Date(savedSession.startMonth),
      visibleMonth: new Date(savedSession.visibleMonth),
      dayPage: savedSession.dayPage ?? 0,
      selectedDates: new Set(savedSession.selectedDates)
    });
  }
}
```

Replace with:

```javascript
function loadSessions() {
  if (!existsSync(SESSIONS_FILE)) {
    return;
  }

  const savedSessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
  const todayKey = dateKey(new Date());

  for (const savedSession of savedSessions) {
    sessions.set(savedSession.id, {
      id: savedSession.id,
      userId: savedSession.userId,
      channelId: savedSession.channelId,
      title: savedSession.title,
      windowStart: savedSession.windowStart ?? todayKey,
      selectedDates: new Set(savedSession.selectedDates)
    });
  }
}
```

The deprecated fields (`startMonth`, `visibleMonth`, `monthOffset`, `dayPage`) are dropped on load. This matches the spec's "tolerated" stance (§6.1).

- [ ] **Step 5: Verify `saveSessions` is still correct**

Locate `saveSessions` in `src/polls.js`. Current:

```javascript
function saveSessions() {
  mkdirSync(dirname(SESSIONS_FILE), { recursive: true });
  const savedSessions = [...sessions.values()].map((session) => ({
    ...session,
    selectedDates: [...session.selectedDates]
  }));

  writeFileSync(SESSIONS_FILE, JSON.stringify(savedSessions, null, 2));
}
```

No edits required — the spread serializes whichever fields are present on the in-memory session. Visually confirm; do not modify.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all `polls.test.js` tests pass. All previous tests still pass.

- [ ] **Step 7: Wipe stale on-disk session state**

If `data/sessions.json` exists and contains entries from the old shape, run:

```powershell
Remove-Item data/sessions.json -ErrorAction SilentlyContinue
```

Old entries deserialize fine (the loader tolerates them), but they reference a UI that no longer exists, so clearing avoids surfacing zombie setups in dev.

- [ ] **Step 8: Commit**

```bash
git add src/polls.js src/polls.test.js
git commit -m "feat(polls): replace month-anchor session state with windowStart"
```

---

## Task 9: Wire the new flow into `src/index.js`

**Files:**
- Modify: `src/index.js`

This is the integration step. The send-side learns the V2 flag; the receive-side speaks the new action vocabulary.

- [ ] **Step 1: Update imports**

Open `src/index.js`. Replace the top imports:

```javascript
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
```

with:

```javascript
import {
  Client,
  Events,
  GatewayIntentBits,
  InteractionType,
  MessageFlags
} from "discord.js";
import {
  createPollRows,
  createSetupRows,
  parseSetupCustomId,
  POLL_PREFIX,
  SETUP_PREFIX
} from "./components.js";
import { registerCommands } from "./commands.js";
import { addDays, dateKey, parseDateKey } from "./date-utils.js";
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
```

Removed: `EmbedBuilder`, `addMonths`, `getMonthDays`, `monthLabel`, `renderCalendar` (only used by the deleted setup-view embed). Added: `addDays`, `dateKey`, `parseDateKey`, `parseSetupCustomId`.

- [ ] **Step 2: Update `handleDatePollCommand` to send Components V2**

Locate this function:

```javascript
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
```

Replace with:

```javascript
async function handleDatePollCommand(interaction) {
  const session = createSetupSession({
    userId: interaction.user.id,
    channelId: interaction.channelId,
    title: interaction.options.getString("title", true)
  });

  await interaction.reply({
    components: createSetupRows(session),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}
```

- [ ] **Step 3: Replace `handleSetupInteraction` body**

The whole `handleSetupInteraction` function is rewritten. Locate it (currently ~100 lines) and replace it with:

```javascript
async function handleSetupInteraction(interaction) {
  const parsed = parseSetupCustomId(interaction.customId);
  if (!parsed) {
    return;
  }
  const { sessionId, action, dateKey: clickedKey } = parsed;
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

  if (action === "day") {
    toggleDate(session, clickedKey);
    saveSetupSessions();
    await interaction.update({
      components: createSetupRows(session),
      flags: MessageFlags.IsComponentsV2
    });
    return;
  }

  if (action === "more") {
    session.windowStart = dateKey(addDays(parseDateKey(session.windowStart), 30));
    saveSetupSessions();
    await interaction.update({
      components: createSetupRows(session),
      flags: MessageFlags.IsComponentsV2
    });
    return;
  }

  if (action === "publish") {
    await publishPoll(interaction, session);
  }
}

function toggleDate(session, key) {
  if (session.selectedDates.has(key)) {
    session.selectedDates.delete(key);
  } else {
    session.selectedDates.add(key);
  }
}

async function publishPoll(interaction, session) {
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
    const channel = interaction.channel?.isTextBased()
      ? interaction.channel
      : await interaction.client.channels.fetch(session.channelId);

    if (!channel?.isTextBased()) {
      throw new Error("Target channel is not text-based.");
    }

    const message = await channel.send(pollPayload);
    setPollMessageTarget(poll, {
      channelId: channel.id,
      messageId: message.id
    });
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
    components: [],
    flags: MessageFlags.IsComponentsV2
  });
  await interaction.followUp({
    content: "Poll published.",
    flags: MessageFlags.Ephemeral
  });
}
```

- [ ] **Step 4: Delete `createSetupEmbed`**

Search `src/index.js` for `function createSetupEmbed`. Delete that function entirely (it is no longer referenced).

- [ ] **Step 5: Delete `updateSelectedDates`**

Search `src/index.js` for `function updateSelectedDates`. Delete that function entirely (replaced by `toggleDate` above).

- [ ] **Step 6: Run tests to confirm nothing in the unit suite broke**

Run: `npm test`
Expected: all existing tests pass. No new tests were added in this task — the rewrite is integration-level and is covered by the manual smoke test in Task 10.

- [ ] **Step 7: Commit**

```bash
git add src/index.js
git commit -m "feat(index): switch /datepoll setup to Components V2 button grid"
```

---

## Task 10: Manual smoke test in dev Discord server

**Files:** None — operational verification only.

This task is the manual verification path described in spec §10. It is the only end-to-end check; there is no harness for the Discord gateway in this repo.

- [ ] **Step 1: Confirm `.env` is configured**

In the project root:

```powershell
Get-Content .env | Select-String DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
```

All three must be present and non-placeholder. If `DISCORD_GUILD_ID` points at a dev server you can write in, you're fine. If it does not, set it before continuing.

- [ ] **Step 2: Start the bot**

Run: `npm start`
Expected log lines (in order):
- `Registered commands for guild <id>.`
- `Auto-deployed slash commands at startup.`
- `Logged in as <bot>#<discriminator>.`

If anything else is logged at error level, stop and read the message.

- [ ] **Step 3: Run `/datepoll title:Smoke Test` in the dev server**

In Discord, in a channel where the bot can post, type `/datepoll` and submit with `title: Smoke Test`.

Expected: an ephemeral message appears with:
- A bold "Smoke Test" line and `_No dates selected yet — tap a day to add it._`
- A 6-row grid of grey day buttons labeled `Mo 26`, `Tu 27`, … starting at today.
- Final row: `[Show more →] [Publish (0)]`. Publish is greyed out.

- [ ] **Step 4: Click 3 day buttons**

Pick 3 different days across the grid. Expected:
- Each clicked button flips from grey to green.
- The summary line updates: `3 dates selected — <three date labels in chronological order>`.
- Publish label updates to `Publish (3)` and becomes enabled (blurple).

- [ ] **Step 5: Click one of the green buttons again**

Expected: it flips back to grey; summary drops to `2 dates selected — …`; Publish reads `Publish (2)`.

- [ ] **Step 6: Click `Show more →`**

Expected: the grid replaces itself with the next 30 days (starting at today + 30). Previously selected dates (now outside the visible window) remain in the summary line. New buttons are all grey.

- [ ] **Step 7: Click Publish**

Expected:
- The ephemeral setup message clears.
- A new ephemeral "Poll published." follow-up appears.
- A public poll message appears in the channel, listing exactly the dates you selected (across both windows), each with the existing voting StringSelectMenu.

- [ ] **Step 8: Cast a vote on the published poll**

Expected: the poll embed updates with the vote count and voter mention. (No changes to the voting view in this task — sanity check that the publish path still works.)

- [ ] **Step 9: Run `/datepoll` again, then dismiss the ephemeral**

Right-click → Dismiss message. Expected: the ephemeral disappears. (This validates that we don't need an explicit Cancel button.)

- [ ] **Step 10: Stop the bot**

`Ctrl+C` in the terminal running `npm start`.

If every step matched expectations, the feature is done. If any step diverged, file the failure mode against the spec and stop before claiming the task complete.

---

## Self-Review Notes

Spec coverage check ran against `docs/superpowers/specs/2026-05-26-button-grid-calendar-design.md`:

- §1 Goal — Tasks 7, 9 deliver the button grid + summary ✓
- §3 User flow — Task 10 walks every step ✓
- §4.1 Button labels — Task 4 (`buttonDayLabel`) ✓
- §4.2 Button styles — Task 7 (Success vs Secondary, Publish Primary + disabled) ✓
- §4.3 Summary rules — Task 5 (`summaryLine`) ✓
- §5 Component count = 40 — Task 7 tests assert 8 top-level + 30+2 buttons ✓
- §6.1 Session shape — Task 8 (`windowStart` + loader default) ✓
- §6.2 Window math — Task 7 (uses `addDays` from Task 3) ✓
- §7 Interaction handling — Task 9 (`day:<key>`, `more`, `publish`) ✓
- §8 File-level impact — Mirrored in this plan's File Structure section ✓
- §9 Edge cases — Owner check and 50001/50013 preserved in Task 9 ✓
- §10 Testing strategy — Tasks 3, 4, 5, 6, 7, 8 (unit) + Task 10 (smoke) ✓
- §11 Rollout — Single sequence of commits, no migration ✓
- §12 Open question — Default (a) is implemented; no `← Earlier` button ✓
