# Start Timer `start_at` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional `start_at` support to `intervals_start_timer`, with local wall-clock shortcuts like `9:30`.

**Architecture:** Add a focused parser module that converts supported `start_at` strings into a `Date` using local-time semantics where appropriate. Wire that parser into the public tool and pass the parsed date through the existing `TimerService.startTimer({ now })` path; no database schema or timer service persistence changes are needed.

**Tech Stack:** TypeScript, Node 22 `node:test`, TypeBox tool schemas, existing pi extension tool registration.

---

## File Structure

- Create `src/start-at.ts`: small parsing helper for timer start times.
- Create `tests/start-at.test.ts`: unit tests for parser behavior independent of tool registration.
- Modify `src/tools.ts`: expose optional `start_at`, parse it, and pass the result as `now`.
- Modify `tests/tools.test.ts`: verify the public tool passes parsed `start_at` into `timerService.startTimer` and rejects invalid values through the parser.
- Modify `README.md`: document the optional `start_at` parameter and accepted formats.

---

### Task 1: Add the `start_at` parser

**Files:**
- Create: `src/start-at.ts`
- Create: `tests/start-at.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `tests/start-at.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseTimerStartAt } from "../src/start-at.js";

function assertLocalDateTime(date: Date, expected: { year: number; month: number; day: number; hour: number; minute: number }) {
  assert.equal(date.getFullYear(), expected.year);
  assert.equal(date.getMonth() + 1, expected.month);
  assert.equal(date.getDate(), expected.day);
  assert.equal(date.getHours(), expected.hour);
  assert.equal(date.getMinutes(), expected.minute);
  assert.equal(date.getSeconds(), 0);
  assert.equal(date.getMilliseconds(), 0);
}

test("parseTimerStartAt parses HH:mm as today in local time", () => {
  const reference = new Date(2026, 4, 13, 10, 0, 0, 0);
  const parsed = parseTimerStartAt("9:30", reference);

  assertLocalDateTime(parsed, { year: 2026, month: 5, day: 13, hour: 9, minute: 30 });
});

test("parseTimerStartAt parses zero-padded HH:mm as today in local time", () => {
  const reference = new Date(2026, 4, 13, 10, 0, 0, 0);
  const parsed = parseTimerStartAt("09:30", reference);

  assertLocalDateTime(parsed, { year: 2026, month: 5, day: 13, hour: 9, minute: 30 });
});

test("parseTimerStartAt parses YYYY-MM-DD HH:mm as local date and time", () => {
  const reference = new Date(2026, 4, 13, 10, 0, 0, 0);
  const parsed = parseTimerStartAt("2026-05-12 16:45", reference);

  assertLocalDateTime(parsed, { year: 2026, month: 5, day: 12, hour: 16, minute: 45 });
});

test("parseTimerStartAt parses ISO datetimes exactly", () => {
  const reference = new Date("2026-05-13T10:00:00.000Z");
  const parsed = parseTimerStartAt("2026-05-13T09:30:00.000Z", reference);

  assert.equal(parsed.toISOString(), "2026-05-13T09:30:00.000Z");
});

test("parseTimerStartAt rejects invalid values", () => {
  const reference = new Date(2026, 4, 13, 10, 0, 0, 0);

  assert.throws(() => parseTimerStartAt("not a time", reference), /invalid start_at: not a time/);
  assert.throws(() => parseTimerStartAt("25:00", reference), /invalid start_at: 25:00/);
  assert.throws(() => parseTimerStartAt("2026-05-13 09:99", reference), /invalid start_at: 2026-05-13 09:99/);
});

test("parseTimerStartAt rejects start times in the future", () => {
  const reference = new Date(2026, 4, 13, 10, 0, 0, 0);

  assert.throws(() => parseTimerStartAt("10:01", reference), /start_at cannot be in the future: 10:01/);
});
```

- [ ] **Step 2: Run parser tests to verify they fail**

Run:

```bash
npx tsx --test tests/start-at.test.ts
```

Expected: FAIL because `src/start-at.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `src/start-at.ts`:

```ts
export function parseTimerStartAt(input: string, referenceDate = new Date()): Date {
  const value = input.trim();
  if (!value) throw new Error(`invalid start_at: ${input}`);

  const timeOnly = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (timeOnly) {
    const hour = Number(timeOnly[1]);
    const minute = Number(timeOnly[2]);
    const parsed = buildLocalDateTime(
      referenceDate.getFullYear(),
      referenceDate.getMonth() + 1,
      referenceDate.getDate(),
      hour,
      minute,
      input,
    );
    return rejectFuture(parsed, referenceDate, input);
  }

  const localDateTime = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(value);
  if (localDateTime) {
    const parsed = buildLocalDateTime(
      Number(localDateTime[1]),
      Number(localDateTime[2]),
      Number(localDateTime[3]),
      Number(localDateTime[4]),
      Number(localDateTime[5]),
      input,
    );
    return rejectFuture(parsed, referenceDate, input);
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid start_at: ${input}`);
  return rejectFuture(parsed, referenceDate, input);
}

function buildLocalDateTime(year: number, month: number, day: number, hour: number, minute: number, original: string): Date {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`invalid start_at: ${original}`);
  }

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() + 1 !== month ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    throw new Error(`invalid start_at: ${original}`);
  }

  return parsed;
}

function rejectFuture(parsed: Date, referenceDate: Date, original: string): Date {
  if (parsed.getTime() > referenceDate.getTime()) {
    throw new Error(`start_at cannot be in the future: ${original}`);
  }
  return parsed;
}
```

- [ ] **Step 4: Run parser tests to verify they pass**

Run:

```bash
npx tsx --test tests/start-at.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit parser**

Run:

```bash
git add src/start-at.ts tests/start-at.test.ts
git commit -m "feat(timers): parse timer start_at values"
```

---

### Task 2: Expose `start_at` on `intervals_start_timer`

**Files:**
- Modify: `src/tools.ts`
- Modify: `tests/tools.test.ts`

- [ ] **Step 1: Write failing tool tests**

In `tests/tools.test.ts`, after the existing `intervals_start_timer requires only description` test, add:

```ts
test("intervals_start_timer passes parsed start_at to timer service", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_start_timer")!;

  await tool.execute(
    "call-1",
    { description: "write tests", start_at: "2000-01-01T09:30:00.000Z" },
    undefined,
    undefined,
    {} as any,
  );

  const [input] = calls.startTimer[0] as [{ now?: Date }];
  assert.equal(input.now?.toISOString(), "2000-01-01T09:30:00.000Z");
});

test("intervals_start_timer rejects invalid start_at", async () => {
  const { pi, tools } = fakePi();
  const { runtime } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_start_timer")!;

  await assert.rejects(
    () => tool.execute("call-1", { description: "write tests", start_at: "not a time" }, undefined, undefined, {} as any),
    /invalid start_at: not a time/,
  );
});
```

- [ ] **Step 2: Run tool tests to verify they fail**

Run:

```bash
npx tsx --test tests/tools.test.ts
```

Expected: FAIL because `start_at` is ignored and no `now` is passed to `timerService.startTimer`.

- [ ] **Step 3: Wire parser into the tool**

In `src/tools.ts`, add this import near the existing local imports:

```ts
import { parseTimerStartAt } from "./start-at.js";
```

Update the `intervals_start_timer` tool description and prompt text to mention `start_at`:

```ts
description:
  "Start a local timer to capture work in progress. Only a description is required. Optional project, worktype, module, and start_at hints can be provided but are not required. Timers are local-only and are not synced to Intervals until stopped.",
promptSnippet: "intervals_start_timer — begin a local timer with an optional local start time",
promptGuidelines: [
  "Use intervals_start_timer when the user begins a new task. Only description is required.",
  "Use start_at for user-specified local wall-clock starts such as 09:30; omit it to start at the current time.",
  "Do not block timer start if project/worktype/module are unknown; capture them when stopping the timer.",
  "intervals_start_timer is local-only and does not create an Intervals timer resource.",
],
```

Add `start_at` to the `parameters` object:

```ts
start_at: Type.Optional(Type.String({ description: "Optional start time. Accepts HH:mm for today in local time, YYYY-MM-DD HH:mm for local date/time, or an ISO datetime." })),
```

Update the `execute` body for `intervals_start_timer`:

```ts
execute: async (_toolCallId, params) => {
  const projectId = resolveProjectQuery(runtime, params.project_query) ?? params.project_id;
  const now = params.start_at ? parseTimerStartAt(params.start_at) : undefined;
  const timer = runtime.timerService.startTimer({
    description: params.description,
    projectId,
    worktypeId: params.worktype_id,
    moduleId: params.module_id,
    notes: params.notes,
    now,
  });
  return textResult(formatTimer(timer), { timer });
},
```

- [ ] **Step 4: Run tool and parser tests**

Run:

```bash
npx tsx --test tests/start-at.test.ts tests/tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit tool wiring**

Run:

```bash
git add src/tools.ts tests/tools.test.ts
git commit -m "feat(tools): support timer start_at"
```

---

### Task 3: Update docs and run full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README tool table**

In `README.md`, change the `intervals_start_timer` row from:

```md
| `intervals_start_timer`          | Start a local timer with a simple description; project/worktype/module are optional |
```

to:

```md
| `intervals_start_timer`          | Start a local timer with a simple description and optional `start_at`; project/worktype/module are optional |
```

- [ ] **Step 2: Add README note for `start_at` formats**

After the Agent tools table, add:

```md
`intervals_start_timer` accepts optional `start_at` values for retroactive local timer starts. Use `HH:mm` or `H:mm` for today in local time, `YYYY-MM-DD HH:mm` for a local date/time, or an ISO datetime with an explicit offset/timezone. Future `start_at` values are rejected.
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run check
```

Expected: PASS for `tsc --noEmit` and all `node:test` suites.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add README.md
git commit -m "docs(timers): document start_at support"
```

---

## Self-Review

- Spec coverage: Task 1 covers local wall-clock, local date/time, ISO parsing, invalid input, and future rejection. Task 2 exposes `start_at` on the public tool and uses the existing `TimerService.startTimer({ now })` data flow. Task 3 covers README documentation and full verification.
- Placeholder scan: no TBD/TODO placeholders remain; code snippets are complete for each implementation step.
- Type consistency: `parseTimerStartAt(input, referenceDate?)` returns `Date`; `src/tools.ts` passes that as `now`, matching the existing `StartTimerInput.now?: Date` type.
