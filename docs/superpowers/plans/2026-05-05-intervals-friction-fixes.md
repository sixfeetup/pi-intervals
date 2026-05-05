# Intervals Friction Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pi-intervals usable without SQLite inspection by providing short time-entry IDs, rich official outputs, safe local-time stop edits, better date ranges, and better project search.

**Architecture:** Keep the local-first SQLite model, but make the public tools/commands expose all identifiers and timing fields needed for normal workflows. Add semantic time-edit helpers that update `end_at` and `duration_seconds` together, while preserving legacy UUID rows through short-prefix resolution. Keep changes small and test-driven across stores, services, formatters, commands, tools, and docs.

**Tech Stack:** TypeScript, Node 22, `node:test`, local SQLite via `node:sqlite`, pi extension tools/commands, Intervals REST sync.

---

## User-Visible Output Changes

The implementation must make the following output changes explicit and test-covered. These examples use the friction sessions as fixtures so reviewers can verify that the official tools now expose everything the agent previously used SQLite to discover.

### Recent time entries: `intervals_list_time` and `/intervals-time today`

**Before:** no editable time entry ID and no start/end window.

```text
2026-05-05 2h 12m SFUP001 - System Administration/Internal Services - Six Feet Up (Hosting) | Investigate cost-saving options for EC2 instances in terraform/production/cluster.tf [synced]
```

**After:** row starts with the local short time entry ID and includes the local start/end window when known.

```text
4ee96f17 2026-05-05 07:07-08:35 1h 30m SFUP001 - System Administration/Internal Services - Six Feet Up (Development) | Investigate cost-saving options for EC2 instances in terraform/production/cluster.tf [synced]
```

Expected user benefit: the user or agent can immediately run `/intervals-time edit 4ee96f17 ...` or `intervals_edit_time(time_entry_id="4ee96f17", ...)` without reading SQLite.

### Agent lookup: new `intervals_lookup_time_entry`

**Before:** when the user referenced a stopped timer, the agent had no supported way to find the derived time entry ID, so it inspected SQLite.

**After:** keep timer list output simple for users, and add an agent-facing lookup tool.

Timer output stays focused on the timer:

```text
19ee097c stopped 2h 14m Investigate cost-saving options for EC2 instances in terraform/production/cluster.tf
```

The agent can map that timer to the editable time entry ID with:

```ts
intervals_lookup_time_entry({ timer_id: "19ee097c" })
```

Tool text result:

```text
time_entry_id: 4ee96f17
```

Expected benefit: the user-facing timer list does not grow extra metadata, while the agent no longer needs SQLite to find the ID required by `intervals_edit_time`.

### Stop-time edits: `intervals_edit_time` and `/intervals-time edit`

**Before:** setting only `end_at=10:35` could leave duration unchanged, so output still showed `2h 12m` despite the changed end field.

```text
Time entry updated: 4ee96f17-0374-4d1b-a92a-05956213a007
created=0 updated=1 failed=0

2026-05-05 2h 12m SFUP001 - System Administration/Internal Services - Six Feet Up (Development) | ... [synced]
```

**After:** user-facing stop-time edits use `stop_time=HH:mm`, interpreted as local wall-clock time. The edit recalculates duration, rounds it, and reports before/after timing clearly.

```text
Time entry updated: 4ee96f17
start: 07:07 local
end: 08:35 local
raw duration: 1h 27m
rounded duration: 1h 30m
created=0 updated=1 failed=0
```

Then list/query output shows the same recalculated duration:

```text
4ee96f17 2026-05-05 07:07-08:35 1h 30m SFUP001 - System Administration/Internal Services - Six Feet Up (Development) | Investigate cost-saving options for EC2 instances in terraform/production/cluster.tf [synced]
```

Expected user benefit: the user can say “stop at 08:35” and the extension updates the visible time total correctly without manual duration math or timezone debate.

### Project search: `intervals_find_project_context`

**Before:** searching `sysadmin` returned no projects, and searching `Six Feet Up` returned a noisy broad list where SFUP001 was buried.

```text
No projects found.
```

**After:** abbreviation/synonym matching and ranking make the intended internal project appear first.

```text
67184: SFUP001 - System Administration (Six Feet Up) — worktypes: 118520 Client meeting, 118848 Development, 124393 Hosting, 118521 Project Management; modules: 183570 Internal Services - Six Feet Up
```

Expected user benefit: “Six Feet Up sysadmin” resolves directly to SFUP001 with the candidate worktypes needed to choose Hosting or Development.

### Date ranges: `/intervals-time`

**Before:** `/intervals-time yesterday` failed.

```text
Error: Unknown range: yesterday. Use today, this-week, last-week, this-month, last-month, or YYYY-MM-DD..YYYY-MM-DD
```

**After:** common aliases work.

```text
/intervals-time yesterday
/intervals-time 2026-05-04
/intervals-time this_week
/intervals-time this-week
```

Expected user benefit: routine time review does not require custom `YYYY-MM-DD..YYYY-MM-DD` ranges.

---

## File Structure / Responsibility Map

- Create: `src/local-id.ts`
  - Shared short 8-hex ID generation and exact/short-prefix resolution helpers.
- Create: `src/time-window.ts`
  - Local time display and stop-time duration calculation helpers.
- Modify: `src/time-entry-store.ts`
  - Generate short IDs, resolve legacy UUIDs by unique short prefix, and resolve IDs for all mutation paths.
- Modify: `src/time-service.ts`
  - Use short IDs for new direct time entries; support semantic `stopTime` edits that recalculate duration.
- Modify: `src/timer-service.ts`
  - Use short IDs for timer-derived time entries.
- Modify: `src/format.ts`
  - Show time-entry IDs and local start/end windows in time-entry rows without adding extra timer/remote metadata to user-facing output.
- Modify: `src/tools.ts`
  - Add `intervals_lookup_time_entry`; expose short IDs in list/query outputs; add `stop_time` and optional `time_zone` to `intervals_edit_time`; allow editing by `timer_id`.
- Modify: `src/commands.ts`
  - Show richer `/intervals-time` and `/intervals-timers recent`; add `yesterday`, single-date, and underscore aliases; parse quoted edit args consistently; support `stop_time=`.
- Modify: `src/date-ranges.ts`, `src/types.ts`
  - Add `yesterday` range.
- Modify: `src/catalog-store.ts`
  - Improve search matching/ranking for abbreviations like `sysadmin`, project codes, worktypes, and modules.
- Modify: `README.md`, `skills/intervals-time-entries/SKILL.md`
  - Document short IDs, semantic stop-time edits, local-time assumptions, and avoiding direct SQLite reads.
- Modify tests under `tests/*.test.ts`
  - Add regression coverage for every behavior above.

---

### Task 1: Add shared short-ID helpers

**Files:**
- Create: `src/local-id.ts`
- Test: `tests/local-id.test.ts`

- [ ] **Step 1: Write failing tests for short ID generation and prefix resolution**

Create `tests/local-id.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createShortLocalId, resolveLocalId } from "../src/local-id.js";

test("createShortLocalId returns 8 lowercase hex characters", () => {
  const id = createShortLocalId(() => false);
  assert.match(id, /^[0-9a-f]{8}$/);
});

test("createShortLocalId retries until it finds a free id", () => {
  const ids = ["aaaaaaaa", "bbbbbbbb"];
  let index = 0;
  const id = createShortLocalId(
    (candidate) => candidate === "aaaaaaaa",
    () => ids[index++],
  );
  assert.equal(id, "bbbbbbbb");
});

test("resolveLocalId returns exact matches before prefix matches", () => {
  const resolved = resolveLocalId("abc12345", ["abc12345", "abc12345-0000-0000-0000-000000000000"]);
  assert.equal(resolved, "abc12345");
});

test("resolveLocalId resolves unique 8-character UUID prefix", () => {
  const resolved = resolveLocalId("4ee96f17", ["4ee96f17-0374-4d1b-a92a-05956213a007"]);
  assert.equal(resolved, "4ee96f17-0374-4d1b-a92a-05956213a007");
});

test("resolveLocalId throws for ambiguous 8-character prefixes", () => {
  assert.throws(
    () => resolveLocalId("4ee96f17", [
      "4ee96f17-0374-4d1b-a92a-05956213a007",
      "4ee96f17-aaaa-bbbb-cccc-05956213a007",
    ]),
    /ambiguous/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx tsx --test tests/local-id.test.ts
```

Expected: FAIL because `src/local-id.ts` does not exist.

- [ ] **Step 3: Implement `src/local-id.ts`**

Create `src/local-id.ts`:

```ts
import { randomBytes } from "node:crypto";

const SHORT_ID_RE = /^[0-9a-f]{8}$/i;

export function createShortLocalId(
  exists: (candidate: string) => boolean,
  nextCandidate: () => string = () => randomBytes(4).toString("hex"),
): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = nextCandidate().toLowerCase();
    if (!SHORT_ID_RE.test(candidate)) {
      throw new Error(`short id generator returned invalid id: ${candidate}`);
    }
    if (!exists(candidate)) return candidate;
  }
  throw new Error("could not generate unique short local id");
}

export function resolveLocalId(input: string, candidates: string[], label = "local id"): string | undefined {
  if (candidates.includes(input)) return input;
  if (!SHORT_ID_RE.test(input)) return undefined;

  const matches = candidates.filter((candidate) => candidate.toLowerCase().startsWith(input.toLowerCase()));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`${label} is ambiguous: ${input}`);
  return undefined;
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npx tsx --test tests/local-id.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/local-id.ts tests/local-id.test.ts
git commit -m "feat(ids): add shared short local id helpers"
```

---

### Task 2: Make time entries use short IDs and resolve legacy UUID prefixes

**Files:**
- Modify: `src/time-entry-store.ts`
- Modify: `src/time-service.ts`
- Modify: `src/timer-service.ts`
- Test: `tests/time-editing.test.ts`
- Test: `tests/timer-service.test.ts`

- [ ] **Step 1: Add failing tests for short IDs and legacy prefix editing**

Append to `tests/time-editing.test.ts`:

```ts
test("addTime creates an 8-character local time entry id", () => {
  const { dir, db, catalog, defaults, service } = setup();
  try {
    catalog.replaceCatalog({
      clients: [],
      projects: [{ id: 10, name: "Website", active: true, billable: true, raw: {} }],
      worktypes: [{ id: 100, projectId: 10, worktypeId: 5, name: "Dev", active: true, raw: {} }],
      modules: [],
    });
    defaults.setProjectDefaults({ projectId: 10, defaultWorktypeId: 5 });

    const entry = service.addTime({ projectId: 10, date: "2026-04-24", durationSeconds: 1800 });

    assert.match(entry.localId, /^[0-9a-f]{8}$/);
  } finally {
    db.close();
    teardown(dir);
  }
});

test("editTime resolves legacy UUID entries by unique 8-character prefix", () => {
  const { dir, db, catalog, timeEntries, service } = setup();
  try {
    catalog.replaceCatalog({
      clients: [],
      projects: [{ id: 10, name: "Website", active: true, billable: true, raw: {} }],
      worktypes: [{ id: 100, projectId: 10, worktypeId: 5, name: "Dev", active: true, raw: {} }],
      modules: [],
    });
    timeEntries.insertTimeEntry({
      localId: "4ee96f17-0374-4d1b-a92a-05956213a007",
      projectId: 10,
      worktypeId: 5,
      date: "2026-05-05",
      durationSeconds: 7920,
      billable: true,
      createdAt: "2026-05-05T07:07:43.897Z",
      updatedAt: "2026-05-05T07:07:43.897Z",
    });

    const edited = service.editTime({ localId: "4ee96f17", durationSeconds: 1800 });

    assert.equal(edited.localId, "4ee96f17-0374-4d1b-a92a-05956213a007");
    assert.equal(edited.durationSeconds, 1800);
  } finally {
    db.close();
    teardown(dir);
  }
});
```

Append to `tests/timer-service.test.ts`:

```ts
test("stopTimer creates a short local time entry id", () => {
  const { dir, db, catalog, defaults, service } = setup();
  try {
    catalog.replaceCatalog({
      clients: [],
      projects: [{ id: 10, name: "Website", active: true, billable: true, raw: {} }],
      worktypes: [{ id: 100, projectId: 10, worktypeId: 5, name: "Dev", active: true, raw: {} }],
      modules: [],
    });
    defaults.setProjectDefaults({ projectId: 10, defaultWorktypeId: 5 });
    const timer = service.startTimer({
      description: "Investigate cost-saving options",
      projectId: 10,
      now: new Date("2026-05-05T07:07:43.897Z"),
    });

    const entry = service.stopTimer({ localId: timer.localId, now: new Date("2026-05-05T08:37:00.000Z") });

    assert.match(entry.localId, /^[0-9a-f]{8}$/);
  } finally {
    db.close();
    teardown(dir);
  }
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npx tsx --test tests/time-editing.test.ts tests/timer-service.test.ts
```

Expected: FAIL because new entries still use UUIDs and `getTimeEntry()` does not resolve short prefixes.

- [ ] **Step 3: Update `TimeEntryStore` to generate and resolve short IDs**

Modify `src/time-entry-store.ts`:

```ts
import { createShortLocalId } from "./local-id.js";
```

Add methods inside `TimeEntryStore`:

```ts
  createLocalId(): string {
    return createShortLocalId((candidate) => this.getTimeEntry(candidate) != null);
  }

  resolveLocalId(localId: string): string | undefined {
    const exact = this.db.prepare("select local_id as localId from time_entries where local_id = ?").get(localId) as
      | { localId: string }
      | undefined;
    if (exact) return exact.localId;

    if (!/^[0-9a-f]{8}$/i.test(localId)) return undefined;

    const matches = this.db
      .prepare("select local_id as localId from time_entries where lower(local_id) like lower(?) order by local_id limit 2")
      .all(`${localId}%`) as Array<{ localId: string }>;
    if (matches.length === 1) return matches[0].localId;
    if (matches.length > 1) throw new Error(`time entry id is ambiguous: ${localId}`);
    return undefined;
  }
```

Change `getTimeEntry(localId: string)` to resolve before querying:

```ts
  getTimeEntry(localId: string): TimeEntry | undefined {
    const resolvedLocalId = this.resolveLocalId(localId);
    if (!resolvedLocalId) return undefined;
    const row = this.db.prepare(`${selectColumns} where local_id = ?`).get(resolvedLocalId) as TimeEntryRow | undefined;
    if (!row) return undefined;
    return this.mapRow(row);
  }
```

In `updateTimeEntry`, `setDurationSeconds`, `setRemoteTime`, and `markSyncFailed`, resolve the ID before updating and throw `time entry not found: ${localId}` when resolution fails.

- [ ] **Step 4: Update services to request IDs from the store**

Modify `src/time-service.ts`:

```ts
// Remove: import { randomUUID } from "node:crypto";
```

Change `addTime()` insert input:

```ts
      localId: this.deps.timeEntryStore.createLocalId(),
```

Modify `src/timer-service.ts`:

```ts
// Remove randomUUID from the import line.
import { randomBytes } from "node:crypto";
```

Change `stopTimer()` insert input:

```ts
        localId: this.timeEntryStore.createLocalId(),
```

- [ ] **Step 5: Run focused tests and verify they pass**

Run:

```bash
npx tsx --test tests/time-editing.test.ts tests/timer-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/time-entry-store.ts src/time-service.ts src/timer-service.ts tests/time-editing.test.ts tests/timer-service.test.ts
git commit -m "feat(time): use short local ids for time entries"
```

---

### Task 3: Add local time-window formatting and show short IDs in reports

**Files:**
- Create: `src/time-window.ts`
- Modify: `src/format.ts`
- Test: `tests/time-window.test.ts`
- Test: `tests/format.test.ts`

- [ ] **Step 1: Write failing tests for time windows and richer entry format**

Create `tests/time-window.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { formatLocalTimeOfDay, formatTimeEntryWindow } from "../src/time-window.js";

test("formatLocalTimeOfDay renders ISO timestamps as local HH:mm", () => {
  const text = formatLocalTimeOfDay("2026-05-05T07:07:43.897Z", "en-GB");
  assert.match(text, /^\d{2}:\d{2}$/);
});

test("formatLocalTimeOfDay preserves bare HH:mm values", () => {
  assert.equal(formatLocalTimeOfDay("08:35", "en-GB"), "08:35");
});

test("formatTimeEntryWindow renders start and end when both are present", () => {
  const text = formatTimeEntryWindow({ startAt: "07:07", endAt: "08:35" });
  assert.equal(text, "07:07-08:35");
});

test("formatTimeEntryWindow renders empty string when start or end is missing", () => {
  assert.equal(formatTimeEntryWindow({ startAt: "07:07" }), "");
});
```

Add to `tests/format.test.ts`:

```ts
test("formatTimeEntry starts with short id and includes time window", () => {
  const entry: TimeEntry = {
    localId: "4ee96f17",
    remoteId: 114010155,
    sourceTimerId: "19ee097c",
    projectId: 67184,
    worktypeId: 118848,
    moduleId: 183570,
    date: "2026-05-05",
    startAt: "07:07",
    endAt: "08:35",
    durationSeconds: 5400,
    description: "Investigate cost-saving options",
    billable: true,
    syncStatus: "synced",
    syncAttempts: 0,
    createdAt: "2026-05-05T07:07:43.897Z",
    updatedAt: "2026-05-05T08:35:00.000Z",
  };

  const formatted = formatTimeEntry({
    ...entry,
    projectName: "SFUP001 - System Administration",
    worktypeName: "Development",
    moduleName: "Internal Services - Six Feet Up",
  });

  assert.ok(formatted.startsWith("4ee96f17 2026-05-05 07:07-08:35 1h 30m"), formatted);
  assert.ok(!formatted.includes("timer="), formatted);
  assert.ok(!formatted.includes("remote="), formatted);
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npx tsx --test tests/time-window.test.ts tests/format.test.ts
```

Expected: FAIL because `src/time-window.ts` does not exist and formatter does not include IDs/windows.

- [ ] **Step 3: Implement `src/time-window.ts`**

Create `src/time-window.ts`:

```ts
export function formatLocalTimeOfDay(value: string | undefined, locale = undefined as string | undefined): string {
  if (!value) return "";
  if (/^\d{1,2}:\d{2}$/.test(value)) return value.padStart(5, "0");

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatTimeEntryWindow(input: { startAt?: string; endAt?: string }, locale?: string): string {
  if (!input.startAt || !input.endAt) return "";
  return `${formatLocalTimeOfDay(input.startAt, locale)}-${formatLocalTimeOfDay(input.endAt, locale)}`;
}
```

- [ ] **Step 4: Update `formatTimeEntry()` user-facing prefix**

Modify `src/format.ts`:

```ts
import { formatTimeEntryWindow } from "./time-window.js";
```

Change `formatTimeEntry()` so user-facing rows start with the short time entry ID and local time window, but do not append timer or remote metadata:

```ts
  const id = entry.localId.slice(0, 8);
  const window = formatTimeEntryWindow(entry);
  const windowPart = window ? ` ${window}` : "";
  let line = `${id} ${entry.date}${windowPart} ${dur} ${project}${mod} (${worktype})${desc}`;
```

Keep the existing sync-status behavior after the row content. Do not add `{timer=...}` or `{remote=...}` to the text output; agent-only ID mapping is handled by `intervals_lookup_time_entry`.

- [ ] **Step 5: Run focused tests and verify they pass**

Run:

```bash
npx tsx --test tests/time-window.test.ts tests/format.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/time-window.ts src/format.ts tests/time-window.test.ts tests/format.test.ts
git commit -m "feat(format): show time entry ids and windows"
```

---

### Task 4: Add an agent-only timer-to-time-entry lookup tool

**Files:**
- Modify: `src/tools.ts`
- Test: `tests/tools.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add failing tool registration and behavior tests**

In `tests/tools.test.ts`, update the registered tool list expectation to include `intervals_lookup_time_entry`.

Add:

```ts
test("intervals_lookup_time_entry returns the time entry id for a source timer", async () => {
  const { pi, tools } = fakePi();
  const { runtime } = fakeRuntime();
  (runtime.timeEntryStore as any).findBySourceTimerId = () => ({ localId: "4ee96f17" });
  registerIntervalsTools(runtime, pi);

  const tool = tools.find((t) => t.name === "intervals_lookup_time_entry")!;
  const result = await tool.execute("call-1", { timer_id: "19ee097c" }, undefined, undefined, {} as any);
  const text = String((result.content[0] as { type: "text"; text: string }).text);

  assert.equal(text.trim(), "time_entry_id: 4ee96f17");
  assert.deepEqual((result as any).details, { timeEntryId: "4ee96f17", timerId: "19ee097c" });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npx tsx --test tests/tools.test.ts
```

Expected: FAIL because `intervals_lookup_time_entry` is not registered.

- [ ] **Step 3: Implement `intervals_lookup_time_entry`**

In `src/tools.ts`, register a new tool near the timer/time-entry tools:

```ts
  pi.registerTool(
    defineTool({
      name: "intervals_lookup_time_entry",
      label: "Lookup Intervals time entry",
      description: "Find the local time entry ID linked to a stopped local timer. Agent-facing lookup to avoid SQLite inspection.",
      promptSnippet: "intervals_lookup_time_entry — map a stopped timer ID to its linked time entry ID",
      promptGuidelines: [
        "Use intervals_lookup_time_entry when the user references a stopped timer but intervals_edit_time needs a time entry ID.",
        "Do not inspect the SQLite database to map timers to time entries.",
      ],
      parameters: Type.Object({
        timer_id: Type.String({ description: "Local timer ID" }),
      }),
      execute: async (_toolCallId, params) => {
        const entry = runtime.timeEntryStore.findBySourceTimerId(params.timer_id);
        if (!entry) throw new Error(`no time entry linked to timer: ${params.timer_id}`);
        return textResult(`time_entry_id: ${entry.localId.slice(0, 8)}`, {
          timeEntryId: entry.localId.slice(0, 8),
          timerId: params.timer_id,
        });
      },
    }),
  );
```

- [ ] **Step 4: Keep timer list output unchanged**

Do not change `formatTimer()`, `formatBrightTimer()`, `/intervals-timers recent`, or `intervals_list_timers` to display linked time entry IDs. The lookup is intentionally agent-facing so user-visible timer output stays simple.

- [ ] **Step 5: Update README tool list**

Add to the Agent tools table in `README.md`:

```md
| `intervals_lookup_time_entry`   | Map a stopped local timer ID to the linked local time entry ID                       |
```

- [ ] **Step 6: Run focused test and verify it passes**

Run:

```bash
npx tsx --test tests/tools.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tools.ts tests/tools.test.ts README.md
git commit -m "feat(tools): add timer to time entry lookup"
```

---

### Task 5: Add semantic stop-time editing with duration recalculation

**Files:**
- Modify: `src/time-window.ts`
- Modify: `src/time-service.ts`
- Modify: `src/tools.ts`
- Modify: `src/commands.ts`
- Test: `tests/time-window.test.ts`
- Test: `tests/time-editing.test.ts`
- Test: `tests/tools.test.ts`
- Test: `tests/commands.test.ts`

- [ ] **Step 1: Add failing tests for local stop-time duration calculation**

Append to `tests/time-window.test.ts`:

```ts
import { calculateDurationForLocalStopTime } from "../src/time-window.js";

test("calculateDurationForLocalStopTime calculates duration from local HH:mm stop time", () => {
  const result = calculateDurationForLocalStopTime({
    date: "2026-05-05",
    startAt: "2026-05-05T05:07:43.897Z",
    stopTime: "08:35",
  });

  assert.equal(result.endAt, "08:35");
  assert.equal(result.durationSeconds, 5240);
});

test("calculateDurationForLocalStopTime rejects stop times before local start time", () => {
  assert.throws(
    () => calculateDurationForLocalStopTime({
      date: "2026-05-05",
      startAt: "2026-05-05T07:07:43.897Z",
      stopTime: "06:35",
    }),
    /before start time/,
  );
});
```

Append to `tests/time-editing.test.ts`:

```ts
test("editTime stopTime updates endAt and rounded duration together", () => {
  const { dir, db, catalog, timeEntries, service } = setup();
  try {
    catalog.replaceCatalog({
      clients: [],
      projects: [{ id: 67184, name: "SFUP001 - System Administration", active: true, billable: true, raw: {} }],
      worktypes: [{ id: 1, projectId: 67184, worktypeId: 118848, name: "Development", active: true, raw: {} }],
      modules: [{ id: 2, projectId: 67184, moduleId: 183570, name: "Internal Services - Six Feet Up", active: true, raw: {} }],
    });
    timeEntries.insertTimeEntry({
      localId: "4ee96f17",
      projectId: 67184,
      worktypeId: 118848,
      moduleId: 183570,
      date: "2026-05-05",
      startAt: "2026-05-05T05:07:43.897Z",
      endAt: "2026-05-05T07:22:32.507Z",
      durationSeconds: 7920,
      billable: true,
      syncStatus: "synced",
      createdAt: "2026-05-05T05:07:43.897Z",
      updatedAt: "2026-05-05T07:22:32.507Z",
    });

    const edited = service.editTime({ localId: "4ee96f17", stopTime: "08:35" });

    assert.equal(edited.endAt, "08:35");
    assert.equal(edited.durationSeconds, 5400);
    assert.equal(edited.syncStatus, "pending");
  } finally {
    db.close();
    teardown(dir);
  }
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npx tsx --test tests/time-window.test.ts tests/time-editing.test.ts
```

Expected: FAIL because `calculateDurationForLocalStopTime` and `EditTimeInput.stopTime` do not exist.

- [ ] **Step 3: Implement stop-time calculation**

Add to `src/time-window.ts`:

```ts
export function calculateDurationForLocalStopTime(input: {
  date: string;
  startAt?: string;
  stopTime: string;
}): { endAt: string; durationSeconds: number; rawDurationSeconds: number } {
  if (!input.startAt) throw new Error("start_at is required to calculate duration from stop_time");
  if (!/^\d{1,2}:\d{2}$/.test(input.stopTime)) {
    throw new Error("stop_time must be HH:mm local time");
  }

  const start = new Date(input.startAt);
  if (!Number.isFinite(start.getTime())) throw new Error(`invalid start_at: ${input.startAt}`);

  const [hourText, minuteText] = input.stopTime.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error("stop_time must be HH:mm local time");
  }

  const [year, month, day] = input.date.split("-").map(Number);
  const stop = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (!Number.isFinite(stop.getTime())) throw new Error(`invalid date: ${input.date}`);

  const rawDurationSeconds = Math.floor((stop.getTime() - start.getTime()) / 1000);
  if (rawDurationSeconds < 0) {
    throw new Error(`stop_time ${input.stopTime} is before start time ${formatLocalTimeOfDay(input.startAt)}`);
  }

  return {
    endAt: input.stopTime.padStart(5, "0"),
    durationSeconds: rawDurationSeconds,
    rawDurationSeconds,
  };
}
```

- [ ] **Step 4: Wire semantic stop time into `TimeService.editTime()`**

Modify `src/time-service.ts`:

```ts
import { calculateDurationForLocalStopTime } from "./time-window.js";
```

Add to `EditTimeInput`:

```ts
  /** Bare HH:mm local stop time. Recalculates endAt and durationSeconds together. */
  stopTime?: string;
```

Inside `editTime()`, before building `patch`:

```ts
    if (input.stopTime !== undefined && input.endAt !== undefined) {
      throw new Error("cannot specify both stopTime and endAt");
    }
```

Before applying `input.endAt` and `input.durationSeconds`:

```ts
    let calculatedStop: { endAt: string; durationSeconds: number } | undefined;
    if (input.stopTime !== undefined) {
      calculatedStop = calculateDurationForLocalStopTime({
        date: input.date ?? existing.date,
        startAt: input.startAt === null ? undefined : input.startAt ?? existing.startAt,
        stopTime: input.stopTime,
      });
    }
```

When building patch:

```ts
    if (calculatedStop) {
      patch.endAt = calculatedStop.endAt;
      patch.durationSeconds = roundDurationSecondsForIntervals(calculatedStop.durationSeconds);
    } else {
      if (input.endAt !== undefined) patch.endAt = input.endAt;
      if (input.durationSeconds !== undefined) patch.durationSeconds = roundDurationSecondsForIntervals(input.durationSeconds);
    }
```

- [ ] **Step 5: Add tool and command parameters**

In `src/tools.ts`, add to `intervals_edit_time` parameters:

```ts
        stop_time: Type.Optional(Type.String({ description: "Local stop time as HH:mm. Recalculates duration from start_at and updates end_at." })),
        timer_id: Type.Optional(Type.String({ description: "Source timer ID for the time entry to edit, mutually exclusive with time_entry_id" })),
```

Make `time_entry_id` optional in the schema description and execution. In execution:

```ts
        const localId = params.time_entry_id
          ?? (params.timer_id ? runtime.timeEntryStore.findBySourceTimerId(params.timer_id)?.localId : undefined);
        if (!localId) throw new Error("time_entry_id or timer_id is required");
```

Pass to service:

```ts
          localId,
          stopTime: params.stop_time,
```

In `src/commands.ts`, parse `stop_time=HH:mm` and map to `patch.stopTime`. Keep `end_at` as an advanced raw field, but update usage on missing ID:

```ts
ctx.ui.notify("Usage: /intervals-time edit <time_entry_id> [field=value ...]. Use stop_time=HH:mm to change the local stop time and recalculate duration.", "error");
```

- [ ] **Step 6: Add tests for tool/command `stop_time` plumbing**

Add to `tests/tools.test.ts`:

```ts
test("intervals_edit_time passes stop_time to service", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_edit_time")!;

  await tool.execute("call-1", { time_entry_id: "4ee96f17", stop_time: "08:35" }, undefined, undefined, {} as any);

  const editCall = calls.editTime[0] as [{ stopTime?: string }];
  assert.equal(editCall[0].stopTime, "08:35");
});
```

Add to `tests/commands.test.ts`:

```ts
test("intervals-time edit parses stop_time", async () => {
  const { pi, commands } = fakePi();
  const { runtime, lastEditPatch } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-time")!;
  const ctx = fakeCtx();

  await cmd.handler("edit 4ee96f17 stop_time=08:35", ctx);

  assert.equal(lastEditPatch[0].stopTime, "08:35");
});
```

- [ ] **Step 7: Run focused tests and verify they pass**

Run:

```bash
npx tsx --test tests/time-window.test.ts tests/time-editing.test.ts tests/tools.test.ts tests/commands.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/time-window.ts src/time-service.ts src/tools.ts src/commands.ts tests/time-window.test.ts tests/time-editing.test.ts tests/tools.test.ts tests/commands.test.ts
git commit -m "feat(time): recalculate duration from local stop time"
```

---

### Task 6: Add date range aliases including `yesterday`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/date-ranges.ts`
- Modify: `src/tools.ts`
- Modify: `src/commands.ts`
- Test: `tests/date-ranges.test.ts`
- Test: `tests/commands.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/date-ranges.test.ts`:

```ts
test("resolveDateRange supports yesterday", () => {
  assert.deepEqual(
    resolveDateRange({ range: "yesterday" as any, now: new Date("2026-05-05T12:00:00Z") }),
    { startDate: "2026-05-04", endDate: "2026-05-04" },
  );
});
```

Add to `tests/commands.test.ts`:

```ts
test("intervals-time accepts yesterday", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-time")!;
  const ctx = fakeCtx();

  await cmd.handler("yesterday", ctx);

  assert.equal(calls.queryTime, 1);
});

test("intervals-time accepts a single YYYY-MM-DD date", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls, lastQueryPatch } = fakeRuntime() as any;
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-time")!;
  const ctx = fakeCtx();

  await cmd.handler("2026-05-04", ctx);

  assert.equal(calls.queryTime, 1);
});
```

If the fake runtime does not expose `lastQueryPatch`, only assert `calls.queryTime === 1`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npx tsx --test tests/date-ranges.test.ts tests/commands.test.ts
```

Expected: FAIL because `yesterday` and single dates are not supported.

- [ ] **Step 3: Add `yesterday` to types and date resolver**

Modify `src/types.ts`:

```ts
export type TimeRange = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";
```

Modify `src/date-ranges.ts` after today handling:

```ts
  if (input.range === "yesterday") {
    const yesterday = utcDate(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1);
    return { startDate: ymd(yesterday), endDate: ymd(yesterday) };
  }
```

Modify `src/tools.ts` StringEnum:

```ts
StringEnum(["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "custom"], ...)
```

- [ ] **Step 4: Normalize slash command ranges**

In `src/commands.ts`, replace the range parsing block with:

```ts
      const normalizedArg = arg.replace(/_/g, "-");

      if (normalizedArg === "today") range = "today";
      else if (normalizedArg === "yesterday") range = "yesterday";
      else if (normalizedArg === "this-week") range = "this_week";
      else if (normalizedArg === "last-week") range = "last_week";
      else if (normalizedArg === "this-month") range = "this_month";
      else if (normalizedArg === "last-month") range = "last_month";
      else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
        range = "custom";
        startDate = arg;
        endDate = arg;
      } else if (arg.includes("..")) {
        const [start, end] = arg.split("..");
        range = "custom";
        startDate = start;
        endDate = end;
      } else {
        ctx.ui.notify(
          `Unknown range: ${arg}. Use today, yesterday, this-week, last-week, this-month, last-month, YYYY-MM-DD, or YYYY-MM-DD..YYYY-MM-DD`,
          "error",
        );
        return;
      }
```

- [ ] **Step 5: Run focused tests and verify they pass**

Run:

```bash
npx tsx --test tests/date-ranges.test.ts tests/commands.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/date-ranges.ts src/tools.ts src/commands.ts tests/date-ranges.test.ts tests/commands.test.ts
git commit -m "feat(time): add yesterday and date range aliases"
```

---

### Task 7: Improve project context search and ranking

**Files:**
- Modify: `src/catalog-store.ts`
- Test: `tests/catalog-store.test.ts`

- [ ] **Step 1: Add failing tests for `sysadmin` and module/worktype search**

Append to `tests/catalog-store.test.ts`:

```ts
test("searchProjectContext matches sysadmin alias to System Administration", () => {
  const { dir, db, store } = setup();
  try {
    store.replaceCatalog({
      clients: [{ id: 1, name: "Six Feet Up", active: true, raw: {} }],
      projects: [
        { id: 67184, clientId: 1, name: "SFUP001 - System Administration", active: true, billable: true, raw: {} },
        { id: 67200, clientId: 1, name: "SFUP008 - Business Development", active: true, billable: true, raw: {} },
      ],
      worktypes: [
        { id: 1, projectId: 67184, worktypeId: 124393, name: "Hosting", active: true, raw: {} },
      ],
      modules: [
        { id: 2, projectId: 67184, moduleId: 183570, name: "Internal Services - Six Feet Up", active: true, raw: {} },
      ],
    });

    const results = store.searchProjectContext({ query: "six feet up sysadmin", limit: 5 });

    assert.equal(results[0].projectId, 67184);
  } finally {
    db.close();
    teardown(dir);
  }
});

test("searchProjectContext matches worktype and module names", () => {
  const { dir, db, store } = setup();
  try {
    store.replaceCatalog({
      clients: [{ id: 1, name: "Six Feet Up", active: true, raw: {} }],
      projects: [{ id: 67184, clientId: 1, name: "SFUP001 - System Administration", active: true, billable: true, raw: {} }],
      worktypes: [{ id: 1, projectId: 67184, worktypeId: 124393, name: "Hosting", active: true, raw: {} }],
      modules: [{ id: 2, projectId: 67184, moduleId: 183570, name: "Internal Services - Six Feet Up", active: true, raw: {} }],
    });

    assert.equal(store.searchProjectContext({ query: "hosting", limit: 5 })[0].projectId, 67184);
    assert.equal(store.searchProjectContext({ query: "internal services", limit: 5 })[0].projectId, 67184);
  } finally {
    db.close();
    teardown(dir);
  }
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npx tsx --test tests/catalog-store.test.ts
```

Expected: FAIL because search only checks project/client names and does not expand `sysadmin`.

- [ ] **Step 3: Implement normalized search terms and ranking**

In `src/catalog-store.ts`, add helpers near the top:

```ts
function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bsysadmin\b/g, "system administration")
    .replace(/\bsys admin\b/g, "system administration")
    .replace(/\s+/g, " ")
    .trim();
}
```

Change query matching to load candidate projects with joined aggregate searchable text:

```ts
        `select
          p.id as projectId,
          p.name as projectName,
          p.billable as billable,
          c.id as clientId,
          c.name as clientName,
          coalesce(group_concat(distinct wt.name), '') as worktypeNames,
          coalesce(group_concat(distinct pm.name), '') as moduleNames
        from projects p
        left join clients c on c.id = p.client_id
        left join project_worktypes wt on wt.project_id = p.id
        left join project_modules pm on pm.project_id = p.id
        where ${whereWithoutTextFilters}
        group by p.id, p.name, p.billable, c.id, c.name
        order by p.name
        limit ?`
```

Simpler implementation acceptable for this small catalog: when `options.query` exists, omit the SQL text filter, request a larger candidate set such as `Math.max(limit * 10, 100)`, filter/rank in TypeScript using normalized project/client/worktype/module text, then slice to `limit`.

Ranking rule:

```ts
const score =
  normalizedProjectName.includes(fullQuery) ? 100 :
  normalizedProjectName.includes("sfup001") ? 95 :
  allTermsMatchProject ? 80 :
  allTermsMatchProjectOrClient ? 60 :
  allTermsMatchAnySearchableText ? 40 :
  0;
```

Filter out score `0`, sort by score descending then project name.

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

```bash
npx tsx --test tests/catalog-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/catalog-store.ts tests/catalog-store.test.ts
git commit -m "feat(catalog): improve project search ranking"
```

---

### Task 8: Update docs and agent guidance to prevent direct SQLite workflows

**Files:**
- Modify: `README.md`
- Modify: `skills/intervals-time-entries/SKILL.md`
- Test: none beyond final check

- [ ] **Step 1: Update README command/tool documentation**

In `README.md`, update `/intervals-time` command docs to mention:

```md
- Time-entry rows start with the local short time entry ID used by `/intervals-time edit` and `intervals_edit_time`.
- Use `stop_time=HH:mm` for local stop-time changes; this updates the stored end time and recalculates rounded duration together.
- Supported ranges: `today`, `yesterday`, `this-week`, `last-week`, `this-month`, `last-month`, `YYYY-MM-DD`, and `YYYY-MM-DD..YYYY-MM-DD`.
```

Update Agent tools docs for `intervals_edit_time`:

```md
| `intervals_edit_time` | Edit an existing local time entry by short ID or linked timer ID; use `stop_time` for local stop-time changes that recalculate duration |
```

- [ ] **Step 2: Update skill workflow guidance**

In `skills/intervals-time-entries/SKILL.md`, add under Tool Guidelines:

```md
- Do not read `~/.pi/intervals/intervals.db` directly for normal workflows. Use `intervals_list_time`, `intervals_query_time`, and `intervals_lookup_time_entry`; these expose local time entry IDs, local start/end windows, sync status, and timer-to-entry mapping without direct DB access.
- When the user asks to change an entry's stop/end time using a bare time like `08:35`, use `stop_time` instead of raw `end_at`. `stop_time` is interpreted as local time and recalculates duration from the entry's stored start time.
- If the user gives a stopped timer ID when editing a derived time entry, use `intervals_lookup_time_entry(timer_id=...)` or `intervals_edit_time(timer_id=...)`; do not map the timer to a time entry through SQLite.
```

Add under Common Mistakes:

```md
- Setting `end_at` without updating duration. Use `stop_time` for user-facing stop-time changes.
- Treating stored UTC ISO timestamps as the user's local wall-clock time. For bare user times, use local-time semantic fields.
- Querying SQLite directly to find a time entry ID that official tools now expose.
```

- [ ] **Step 3: Commit**

```bash
git add README.md skills/intervals-time-entries/SKILL.md
git commit -m "docs: clarify intervals time entry workflows"
```

---

### Task 9: Final verification and cleanup

**Files:**
- Potentially modify any files with lint/type/test failures.

- [ ] **Step 1: Run the full project check**

Run:

```bash
npm run check
```

Expected: PASS with typecheck and all tests passing.

- [ ] **Step 2: Manually verify expected TUI-style output in tests or a local smoke run**

Run:

```bash
npm test -- --test-name-pattern="formatTimeEntry starts with short id"
```

Expected: PASS and the tested string shape includes:

```text
4ee96f17 2026-05-05 07:07-08:35 1h 30m ... [synced]
```

- [ ] **Step 3: Inspect git diff for accidental unrelated changes**

Run:

```bash
git diff --stat HEAD
```

Expected: no unstaged changes if every task was committed; otherwise only intended final cleanup changes.

- [ ] **Step 4: Commit final cleanup if needed**

If Step 3 shows intended uncommitted cleanup:

```bash
git add <changed-files>
git commit -m "test: verify intervals friction fixes"
```

If there are no changes, skip this commit.

---

## Self-Review

- **Spec coverage:** The plan covers short time-entry IDs, legacy UUID prefix compatibility, IDs/details in list/query output, agent timer-to-entry lookup, safe local stop-time edits, `yesterday`/range aliases, project search improvements, and docs/skill guidance against direct SQLite workflows.
- **Placeholder scan:** No task contains TBD/TODO placeholders. Each code task includes concrete test and implementation snippets.
- **Type consistency:** New names are consistent across tasks: `createShortLocalId`, `TimeEntryStore.createLocalId`, `TimeEntryStore.resolveLocalId`, `calculateDurationForLocalStopTime`, `EditTimeInput.stopTime`, tool parameter `stop_time`, and slash command field `stop_time`.

---

## Execution Options

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.
