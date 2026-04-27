# pi-intervals Implementation Plan

**Goal:** Build a pi extension package that lets the agent track simple local timers, turn stopped timers into Intervals time entries, edit/add/query local time entries, sync project reference data, and retry time-entry syncs from local SQLite.
**Architecture:** Implement a TypeScript pi extension with a thin `src/index.ts` entry point and testable modules for config, SQLite stores, Intervals API access, sync services, tools, and commands. Timer operations are local-first capture; completed/edited time entries write SQLite first, then attempt Intervals time sync; query/reporting reads SQLite only.
**Tech Stack:** TypeScript, pi extension API, `typebox`, `@mariozechner/pi-ai` `StringEnum`, `better-sqlite3`, Node `fetch`, Node test runner via `tsx --test`, npm scripts.

## 2026-04-27 Product Corrections / Superseding Requirements

These corrections supersede conflicting details in the original task list below. Apply them during implementation rather than exposing timer/time-entry implementation details to the end user.

### Timer UX: timers are local capture only

Timers are a lightweight local capture mechanism, not full time entries and not a user-visible Intervals timer workflow.

- Starting a timer must be easy: require only a short `description` for the task being worked on.
- Starting a timer may accept optional hints (`project_id`, `project_query`, `worktype_id`, `module_id`) if the agent already knows them, but missing project/worktype/module must not block timer start.
- Active timers must allow missing project/worktype/module because the user often does not want to classify work until stopping.
- Stopping a timer is the point where the timer is applied to a full time entry. The stop flow must capture or resolve missing `project`, `worktype`, and optional `module` before creating the time entry.
- The end user should think in terms of “start timer for this work” and “stop/apply timer”, not “sync timer resource then create time resource”.
- In v1, timers should be local-only. Do not sync timers to Intervals `timer/` by default. Sync only finalized `time_entries` to Intervals `time/`.
- Keep the Intervals `timer/` API wrapper isolated if implemented for future compatibility, but no v1 user workflow or required sync path should depend on it.

### Time entry editing is required

The plan must include editing existing local time entries and resyncing them.

- Add an `intervals_edit_time` agent tool.
- Support editing: `project`, `worktype`, `module`, `date`, `start_at`, `end_at`, `duration_minutes`, `description`, and `billable`.
- If a synced entry (`remote_id` present) is edited, mark it `pending`; sync must call `PUT time/{remote_id}/`.
- If an unsynced entry (`remote_id` missing) is edited, keep it as a pending create; sync must call `POST time/`.
- Editing must be local-first: never discard local edits because Intervals sync fails.
- Queries and list commands must show edit-induced sync failures clearly without leaking credentials.

### Schema amendments

Task 3 must use these schema changes:

- `timers.project_id`, `timers.worktype_id`, and `timers.module_id` must be nullable.
- `timers` should store `description text not null` instead of requiring a project-oriented `name`.
- Timer rows do not need `remote_id`, `sync_status`, `sync_attempts`, or `last_sync_error` for v1 if timers are local-only.
- `time_entries` should retain `remote_id`, `sync_status`, `sync_attempts`, and `last_sync_error`.
- `time_entries.source_timer_id` should point to the local timer used to create the entry.
- To avoid a separate operation column, sync can infer create vs update from `remote_id`: pending + no `remote_id` => `POST`; pending + `remote_id` => `PUT`.

### Task amendments

- Replace Task 9’s start/stop behavior with simple-description timer start plus stop/apply-to-time-entry behavior.
- Replace Task 11’s “timer and time entry sync” with “time entry sync”; pending timers are not synced.
- Add a dedicated task after Task 10 for editing time entries before tools are registered.
- Task 13 tools must register `intervals_edit_time`, make `intervals_start_timer` require only `description`, and make `intervals_stop_timer` accept enough classification fields to create the final time entry.
- Task 14 commands should support editing either through `/intervals-time edit ...` or a dedicated command if that is cleaner; the agent tool is the primary requirement.

## Context

- Approved design: `docs/designs/2026-04-24-pi-intervals.md`
- Repo root: `/home/roche/projects/pi/extensions/pi-intervals`
- Current repo is newly initialized; `.pi/` and docs are untracked.
- Extension should be packaged with `package.json` `pi.extensions: ["./src/index.ts"]`.
- Runtime default storage: `~/.pi/intervals`; override with `PI_INTERVALS_HOME`.
- Querying/reporting is local-only and must not call Intervals.

## API Assumptions to Encode Behind One Client

Intervals API root is `https://api.myintervals.com/`. Resource URLs are:

- `client/`
- `project/`
- `projectworktype/`
- `projectmodule/`
- `timer/` (wrapped only for future compatibility; v1 user workflow does not depend on timer sync)
- `time/`

Use JSON requests/responses with `Accept: application/json` and `Content-Type: application/json`.

Authentication should be isolated in `src/intervals-api.ts` so it can be fixed in one place if Intervals credential details differ. Initial implementation should use HTTP Basic auth from `INTERVALS_API_KEY` or config:

```ts
Authorization: `Basic ${Buffer.from(`${apiKey}:X`).toString("base64")}`
```

Never print the API key or full Authorization header.

## Task 0: Commit the approved design before implementation

**Files:**
- Existing: `docs/designs/2026-04-24-pi-intervals.md`

**Step 1: Inspect status**
Run:

```bash
git status --short
```

Expected: `docs/designs/2026-04-24-pi-intervals.md` is untracked.

**Step 2: Commit design**
Run:

```bash
git add docs/designs/2026-04-24-pi-intervals.md .pi/settings.json .pi/git/.gitignore
git commit -m "docs: add pi-intervals design"
```

Expected: commit succeeds. If `.pi/git` has many generated files, only commit `.pi/settings.json` and the design doc unless the user wants `.pi/git` tracked.

## Task 1: Scaffold TypeScript extension package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `tests/smoke.test.ts`

**Step 1: Write package files**

Create `package.json`:

```json
{
  "name": "pi-intervals",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "tsx --test tests/**/*.test.ts",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm test"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "dependencies": {
    "@mariozechner/pi-ai": "0.70.0",
    "@mariozechner/pi-coding-agent": "0.70.0",
    "better-sqlite3": "^11.10.0",
    "typebox": "^1.1.33"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.15.0",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Create minimal `src/index.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function intervalsExtension(_pi: ExtensionAPI) {
  // Tools and commands are registered in later tasks.
}
```

Create `tests/smoke.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import extension from "../src/index.js";

test("extension exports a default function", () => {
  assert.equal(typeof extension, "function");
});
```

**Step 2: Install dependencies**
Run:

```bash
npm install
```

Expected: `node_modules/` and `package-lock.json` are created. `better-sqlite3` installs successfully for current Node.

**Step 3: Verify scaffold**
Run:

```bash
npm run check
```

Expected: typecheck passes and one smoke test passes.

**Step 4: Commit**
Run:

```bash
git add package.json package-lock.json tsconfig.json src/index.ts tests/smoke.test.ts
git commit -m "chore: scaffold pi-intervals extension"
```

## Task 2: Add config and storage path resolution

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

**Step 1: Write failing tests**

Create `tests/config.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getIntervalsHome, loadConfig, resolveCredentials } from "../src/config.js";

test("getIntervalsHome uses PI_INTERVALS_HOME when present", () => {
  const home = getIntervalsHome({ PI_INTERVALS_HOME: "/tmp/pi-intervals-test" });
  assert.equal(home, "/tmp/pi-intervals-test");
});

test("resolveCredentials prefers environment variables over config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-intervals-"));
  try {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ apiKey: "file-key", baseUrl: "https://file.example/" }));
    const config = loadConfig(dir);
    const creds = resolveCredentials(config, { INTERVALS_API_KEY: "env-key", INTERVALS_BASE_URL: "https://env.example/" });
    assert.deepEqual(creds, { apiKey: "env-key", baseUrl: "https://env.example/", source: "env" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

**Step 2: Run test to verify it fails**
Run:

```bash
npm test -- tests/config.test.ts
```

Expected: FAIL because `src/config.ts` does not exist.

**Step 3: Implement config module**

Create `src/config.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_INTERVALS_BASE_URL = "https://api.myintervals.com/";

export interface IntervalsConfig {
  apiKey?: string;
  baseUrl?: string;
  syncIntervalMs?: number;
}

export interface ResolvedCredentials {
  apiKey: string;
  baseUrl: string;
  source: "env" | "config";
}

export function getIntervalsHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.PI_INTERVALS_HOME || join(homedir(), ".pi", "intervals"));
}

export function configPath(home: string): string {
  return join(home, "config.json");
}

export function databasePath(home: string): string {
  return join(home, "intervals.db");
}

export function ensureIntervalsHome(home: string): void {
  mkdirSync(home, { recursive: true });
}

export function loadConfig(home: string): IntervalsConfig {
  const path = configPath(home);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as IntervalsConfig;
}

export function saveConfig(home: string, config: IntervalsConfig): void {
  ensureIntervalsHome(home);
  writeFileSync(configPath(home), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function resolveCredentials(
  config: IntervalsConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedCredentials | undefined {
  const envKey = env.INTERVALS_API_KEY;
  if (envKey) {
    return { apiKey: envKey, baseUrl: env.INTERVALS_BASE_URL || config.baseUrl || DEFAULT_INTERVALS_BASE_URL, source: "env" };
  }
  if (config.apiKey) {
    return { apiKey: config.apiKey, baseUrl: config.baseUrl || DEFAULT_INTERVALS_BASE_URL, source: "config" };
  }
  return undefined;
}
```

**Step 4: Verify**
Run:

```bash
npm run check
```

Expected: PASS.

**Step 5: Commit**
Run:

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: resolve intervals config and credentials"
```

## Task 3: Add SQLite schema and migration

**Files:**
- Create: `src/db.ts`
- Create: `tests/db.test.ts`

**Step 1: Write failing schema test**

Create `tests/db.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";

test("openDatabase creates required tables", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-intervals-db-"));
  try {
    const db = openDatabase(join(dir, "intervals.db"));
    const rows = db.prepare("select name from sqlite_master where type = 'table' order by name").all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    for (const expected of ["clients", "projects", "project_worktypes", "project_modules", "project_defaults", "timers", "time_entries", "settings"]) {
      assert.ok(names.includes(expected), `missing table ${expected}`);
    }
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

**Step 2: Run test to verify it fails**
Run:

```bash
npm test -- tests/db.test.ts
```

Expected: FAIL because `src/db.ts` does not exist.

**Step 3: Implement DB module**

Create `src/db.ts`:

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`
    create table if not exists settings (
      key text primary key,
      value text not null,
      updated_at text not null
    );

    create table if not exists clients (
      id integer primary key,
      name text not null,
      active integer,
      raw_json text not null,
      synced_at text not null
    );

    create table if not exists projects (
      id integer primary key,
      client_id integer,
      name text not null,
      active integer,
      billable integer,
      raw_json text not null,
      synced_at text not null
    );

    create table if not exists project_worktypes (
      id integer primary key,
      project_id integer not null,
      worktype_id integer,
      name text not null,
      active integer,
      raw_json text not null,
      synced_at text not null
    );

    create table if not exists project_modules (
      id integer primary key,
      project_id integer not null,
      module_id integer,
      name text not null,
      active integer,
      raw_json text not null,
      synced_at text not null
    );

    create table if not exists project_defaults (
      project_id integer primary key,
      default_worktype_id integer,
      default_module_id integer,
      updated_at text not null
    );

    create table if not exists timers (
      local_id text primary key,
      project_id integer,
      worktype_id integer,
      module_id integer,
      description text not null,
      notes text,
      started_at text not null,
      stopped_at text,
      elapsed_seconds integer not null default 0,
      state text not null check (state in ('active', 'stopped')),
      created_at text not null,
      updated_at text not null
    );

    create table if not exists time_entries (
      local_id text primary key,
      remote_id integer,
      source_timer_id text,
      project_id integer not null,
      worktype_id integer not null,
      module_id integer,
      date text not null,
      start_at text,
      end_at text,
      duration_seconds integer not null,
      description text,
      billable integer not null default 1,
      sync_status text not null check (sync_status in ('pending', 'synced', 'failed', 'needs_review')),
      sync_attempts integer not null default 0,
      last_sync_error text,
      created_at text not null,
      updated_at text not null
    );

    create index if not exists idx_timers_state on timers(state);
    create index if not exists idx_time_entries_date on time_entries(date);
    create index if not exists idx_time_entries_project on time_entries(project_id);
    create index if not exists idx_time_entries_sync on time_entries(sync_status);
  `);
}
```

**Step 4: Verify**
Run:

```bash
npm run check
```

Expected: PASS.

**Step 5: Commit**
Run:

```bash
git add src/db.ts tests/db.test.ts
git commit -m "feat: add sqlite schema"
```

## Task 4: Add shared types and date utilities

**Files:**
- Create: `src/types.ts`
- Create: `src/date-ranges.ts`
- Create: `tests/date-ranges.test.ts`

**Step 1: Write failing date range tests**

Create `tests/date-ranges.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveDateRange } from "../src/date-ranges.js";

test("today resolves to same start and end date", () => {
  assert.deepEqual(resolveDateRange({ range: "today", now: new Date("2026-04-24T12:00:00Z") }), {
    startDate: "2026-04-24",
    endDate: "2026-04-24",
  });
});

test("this_week uses Monday through Sunday", () => {
  assert.deepEqual(resolveDateRange({ range: "this_week", now: new Date("2026-04-24T12:00:00Z") }), {
    startDate: "2026-04-20",
    endDate: "2026-04-26",
  });
});

test("custom requires dates", () => {
  assert.throws(() => resolveDateRange({ range: "custom", now: new Date("2026-04-24T12:00:00Z") }), /start_date and end_date/);
});
```

**Step 2: Implement types and date utility**

Create `src/types.ts`:

```ts
export type SyncStatus = "pending" | "synced" | "failed" | "needs_review";
export type TimerState = "active" | "stopped";
export type TimeRange = "today" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

export interface ProjectContext {
  projectId: number;
  projectName: string;
  clientId?: number;
  clientName?: string;
  worktypeId?: number;
  worktypeName?: string;
  moduleId?: number;
  moduleName?: string;
}
```

Create `src/date-ranges.ts`:

```ts
import type { TimeRange } from "./types.js";

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

export function resolveDateRange(input: {
  range: TimeRange;
  start_date?: string;
  end_date?: string;
  now?: Date;
}): { startDate: string; endDate: string } {
  const now = input.now ?? new Date();
  const today = utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  if (input.range === "custom") {
    if (!input.start_date || !input.end_date) throw new Error("custom range requires start_date and end_date");
    return { startDate: input.start_date, endDate: input.end_date };
  }

  if (input.range === "today") return { startDate: ymd(today), endDate: ymd(today) };

  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = utcDate(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + mondayOffset);

  if (input.range === "this_week") {
    return { startDate: ymd(monday), endDate: ymd(utcDate(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6)) };
  }
  if (input.range === "last_week") {
    const start = utcDate(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() - 7);
    const end = utcDate(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() - 1);
    return { startDate: ymd(start), endDate: ymd(end) };
  }
  if (input.range === "this_month") {
    return {
      startDate: ymd(utcDate(today.getUTCFullYear(), today.getUTCMonth(), 1)),
      endDate: ymd(utcDate(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)),
    };
  }
  if (input.range === "last_month") {
    return {
      startDate: ymd(utcDate(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)),
      endDate: ymd(utcDate(today.getUTCFullYear(), today.getUTCMonth(), 0)),
    };
  }
  throw new Error(`Unsupported range: ${input.range}`);
}
```

**Step 3: Verify and commit**
Run:

```bash
npm run check
git add src/types.ts src/date-ranges.ts tests/date-ranges.test.ts
git commit -m "feat: add time range utilities"
```

Expected: PASS and commit succeeds.

## Task 5: Add catalog store and project context search

**Files:**
- Create: `src/catalog-store.ts`
- Create: `tests/catalog-store.test.ts`

**Step 1: Write failing tests**

Create `tests/catalog-store.test.ts` with tests that upsert clients/projects/worktypes/modules and search by project/client text:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { CatalogStore } from "../src/catalog-store.js";

test("catalog store upserts and searches project context", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-intervals-catalog-"));
  try {
    const db = openDatabase(join(dir, "intervals.db"));
    const store = new CatalogStore(db);
    store.replaceCatalog({
      clients: [{ id: 1, name: "Acme", active: true, raw: { id: 1, name: "Acme" } }],
      projects: [{ id: 10, clientId: 1, name: "Website", active: true, billable: true, raw: { id: 10 } }],
      worktypes: [{ id: 100, projectId: 10, worktypeId: 5, name: "Development", active: true, raw: { id: 100 } }],
      modules: [{ id: 200, projectId: 10, moduleId: 7, name: "Backend", active: true, raw: { id: 200 } }],
    });

    const matches = store.searchProjectContext({ query: "acme website" });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].projectName, "Website");
    assert.equal(matches[0].clientName, "Acme");
    assert.equal(matches[0].worktypes[0].name, "Development");
    assert.equal(matches[0].modules[0].name, "Backend");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

**Step 2: Implement store**

Create `src/catalog-store.ts` with:

- `CatalogStore.replaceCatalog(input)` transaction that deletes/replaces all reference rows.
- `searchProjectContext({ query?, projectId?, clientId?, limit? })` returning project rows plus worktypes/modules.
- `getProject(projectId)`, `getWorktype(projectId, worktypeId)`, `getModule(projectId, moduleId)` helpers.
- `setLastProjectSync(iso)` and `getLastProjectSync()` via `settings`.

Normalize booleans to `0 | 1`, store raw JSON in `raw_json`.

Essential implementation shape:

```ts
export class CatalogStore {
  constructor(private readonly db: Db) {}

  replaceCatalog(input: ReplaceCatalogInput): void {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db.prepare("delete from project_modules").run();
      this.db.prepare("delete from project_worktypes").run();
      this.db.prepare("delete from projects").run();
      this.db.prepare("delete from clients").run();
      // insert rows with prepared statements
      this.setSetting("last_project_sync", now);
    });
    tx();
  }
}
```

**Step 3: Verify and commit**
Run:

```bash
npm run check
git add src/catalog-store.ts tests/catalog-store.test.ts
git commit -m "feat: store and search intervals project catalog"
```

Expected: PASS.

## Task 6: Add project defaults store and resolver

**Files:**
- Create: `src/project-defaults-store.ts`
- Create: `tests/project-defaults-store.test.ts`

**Step 1: Write tests**

Create tests for setting defaults and resolving worktype/module when omitted:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { ProjectDefaultsStore } from "../src/project-defaults-store.js";

test("project defaults fill missing worktype and module", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-intervals-defaults-"));
  try {
    const db = openDatabase(join(dir, "intervals.db"));
    const store = new ProjectDefaultsStore(db);
    store.setProjectDefaults({ projectId: 10, defaultWorktypeId: 5, defaultModuleId: 7 });
    assert.deepEqual(store.resolveForProject({ projectId: 10 }), { worktypeId: 5, moduleId: 7 });
    assert.deepEqual(store.resolveForProject({ projectId: 10, worktypeId: 6 }), { worktypeId: 6, moduleId: 7 });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

**Step 2: Implement store**

Create `src/project-defaults-store.ts`:

```ts
import type { Db } from "./db.js";

export class ProjectDefaultsStore {
  constructor(private readonly db: Db) {}

  setProjectDefaults(input: { projectId: number; defaultWorktypeId?: number; defaultModuleId?: number }): void {
    this.db.prepare(`
      insert into project_defaults(project_id, default_worktype_id, default_module_id, updated_at)
      values (?, ?, ?, ?)
      on conflict(project_id) do update set
        default_worktype_id = excluded.default_worktype_id,
        default_module_id = excluded.default_module_id,
        updated_at = excluded.updated_at
    `).run(input.projectId, input.defaultWorktypeId ?? null, input.defaultModuleId ?? null, new Date().toISOString());
  }

  getProjectDefaults(projectId: number): { worktypeId?: number; moduleId?: number } | undefined {
    const row = this.db.prepare("select default_worktype_id as worktypeId, default_module_id as moduleId from project_defaults where project_id = ?").get(projectId) as { worktypeId: number | null; moduleId: number | null } | undefined;
    if (!row) return undefined;
    return { worktypeId: row.worktypeId ?? undefined, moduleId: row.moduleId ?? undefined };
  }

  resolveForProject(input: { projectId: number; worktypeId?: number; moduleId?: number }): { worktypeId?: number; moduleId?: number } {
    const defaults = this.getProjectDefaults(input.projectId);
    return {
      worktypeId: input.worktypeId ?? defaults?.worktypeId,
      moduleId: input.moduleId ?? defaults?.moduleId,
    };
  }
}
```

**Step 3: Verify and commit**
Run:

```bash
npm run check
git add src/project-defaults-store.ts tests/project-defaults-store.test.ts
git commit -m "feat: add project defaults"
```

## Task 7: Add Intervals API client with mocked tests

**Files:**
- Create: `src/intervals-api.ts`
- Create: `tests/intervals-api.test.ts`

**Step 1: Write failing tests**

Test URL construction, auth redaction, and response extraction:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { IntervalsApiClient, sanitizeApiError } from "../src/intervals-api.js";

test("api client fetches resource collections with json headers", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ client: [{ id: 1, name: "Acme" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const api = new IntervalsApiClient({ apiKey: "secret", baseUrl: "https://api.example/", fetchImpl });
  const clients = await api.listResource("client");
  assert.deepEqual(clients, [{ id: 1, name: "Acme" }]);
  assert.equal(calls[0].url, "https://api.example/client/");
  assert.equal((calls[0].init.headers as Record<string, string>).Accept, "application/json");
  assert.ok((calls[0].init.headers as Record<string, string>).Authorization.startsWith("Basic "));
});

test("sanitizeApiError removes secrets", () => {
  assert.equal(sanitizeApiError("Authorization: Basic abc secret-key", "secret-key"), "Authorization: Basic [redacted] [redacted]");
});
```

**Step 2: Implement API client**

Create `src/intervals-api.ts`:

```ts
export type IntervalsResource = "client" | "project" | "projectworktype" | "projectmodule" | "timer" | "time";

export class IntervalsApiClient {
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetchImpl?: typeof fetch }) {}

  async listResource(resource: IntervalsResource): Promise<unknown[]> {
    const data = await this.request("GET", resource);
    return extractCollection(data, resource);
  }

  async createResource(resource: "timer" | "time", body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", resource, body);
  }

  async updateResource(resource: "timer" | "time", id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", `${resource}/${id}` as IntervalsResource, body);
  }

  private async request(method: string, resource: string, body?: Record<string, unknown>): Promise<unknown> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const base = this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`;
    const url = new URL(resource.endsWith("/") ? resource : `${resource}/`, base).toString();
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${this.options.apiKey}:X`).toString("base64")}`,
    };
    if (body) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new Error(sanitizeApiError(text || `${response.status} ${response.statusText}`, this.options.apiKey));
    return data;
  }
}

export function extractCollection(data: unknown, resource: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const object = data as Record<string, unknown>;
    for (const key of [resource, `${resource}s`, "items", "data"]) {
      if (Array.isArray(object[key])) return object[key];
    }
  }
  return [];
}

export function sanitizeApiError(message: string, apiKey?: string): string {
  let clean = message.replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [redacted]");
  if (apiKey) clean = clean.split(apiKey).join("[redacted]");
  return clean;
}
```

Note: TypeScript may complain about `updateResource` resource typing. If so, change `request` to accept `resourcePath: string` instead of `IntervalsResource`.

**Step 3: Verify and commit**
Run:

```bash
npm run check
git add src/intervals-api.ts tests/intervals-api.test.ts
git commit -m "feat: add intervals api client"
```

## Task 8: Add catalog sync service

**Files:**
- Create: `src/catalog-sync.ts`
- Create: `tests/catalog-sync.test.ts`

**Step 1: Write tests**

Create a fake API that returns resource rows with variant field names. Verify rows are normalized and stored.

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syncProjectsCatalog } from "../src/catalog-sync.js";
import { CatalogStore } from "../src/catalog-store.js";
import { openDatabase } from "../src/db.js";

test("syncProjectsCatalog fetches all reference resources", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-intervals-sync-"));
  try {
    const db = openDatabase(join(dir, "intervals.db"));
    const store = new CatalogStore(db);
    const resources: string[] = [];
    const api = { listResource: async (resource: string) => {
      resources.push(resource);
      if (resource === "client") return [{ id: 1, name: "Acme", active: "t" }];
      if (resource === "project") return [{ id: 10, clientid: 1, name: "Website", active: "t", billable: "t" }];
      if (resource === "projectworktype") return [{ id: 100, projectid: 10, worktypeid: 5, worktype: "Development", active: "t" }];
      if (resource === "projectmodule") return [{ id: 200, projectid: 10, moduleid: 7, module: "Backend", active: "t" }];
      return [];
    } };
    const result = await syncProjectsCatalog(api, store);
    assert.deepEqual(resources, ["client", "project", "projectworktype", "projectmodule"]);
    assert.equal(result.projects, 1);
    assert.equal(store.searchProjectContext({ query: "website" })[0].modules[0].name, "Backend");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

**Step 2: Implement service**

Create `src/catalog-sync.ts`:

- `syncProjectsCatalog(api, store)` calls `client`, `project`, `projectworktype`, `projectmodule` in order.
- Normalize `clientid` and `client_id` variants.
- Normalize Intervals booleans: `"t"`/`true`/`1` => true, `"f"`/`false`/`0` => false.
- For worktype name use `worktype`, `name`, or `worktypename`.
- For module name use `module`, `name`, or `modulename`.

**Step 3: Verify and commit**
Run:

```bash
npm run check
git add src/catalog-sync.ts tests/catalog-sync.test.ts
git commit -m "feat: sync intervals project catalog"
```

## Task 9: Add timer store and service with multiple timers

**Files:**
- Create: `src/timer-store.ts`
- Create: `src/time-entry-store.ts`
- Create: `src/timer-service.ts`
- Create: `tests/timer-service.test.ts`

**Step 1: Write tests**

Create tests that:

1. Start two active timers with only simple descriptions.
2. Stop one by local ID while providing the missing project/worktype/module context.
3. Verify one remains active.
4. Verify a time entry is created from the stopped timer with the provided context and computed duration.

Key test snippet:

```ts
const first = service.startTimer({ description: "A", now: new Date("2026-04-24T10:00:00Z") });
const second = service.startTimer({ description: "B", now: new Date("2026-04-24T11:00:00Z") });
service.stopTimer({
  localId: first.localId,
  projectId: 10,
  worktypeId: 5,
  moduleId: 7,
  now: new Date("2026-04-24T10:30:00Z"),
});
assert.equal(timerRepo.listActive().length, 1);
assert.equal(timerRepo.listActive()[0].localId, second.localId);
assert.equal(timeRepo.listRecent({ limit: 10 })[0].durationSeconds, 1800);
assert.equal(timeRepo.listRecent({ limit: 10 })[0].projectId, 10);
```

**Step 2: Implement stores**

`src/timer-store.ts` should include:

- `insertTimer(input)`
- `getTimer(localId)`
- `listActive()`
- `listRecent(limit)`
- `markTimerStopped(localId, stoppedAt, elapsedSeconds)`

Timers are local-only in v1, so do not add timer sync methods unless needed for internal bookkeeping.

`src/time-entry-store.ts` should include:

- `insertTimeEntry(input)`
- `getTimeEntry(localId)`
- `updateTimeEntry(localId, patch)`
- `listRecent({ limit })`
- `queryTime({ startDate, endDate, projectId? })`
- `pendingForSync(limit)`
- `setRemoteTime(localId, remoteId)`
- `markSyncFailed(localId, error)`

Use `crypto.randomUUID()` for local IDs.

**Step 3: Implement timer service**

`src/timer-service.ts` should:

- Start timers with `description` only; project/worktype/module hints are optional.
- Allow active timers with no project/worktype/module.
- Allow multiple active timers.
- Stop by `localId` only in the first implementation; description/project unambiguous matching can be added later in tools.
- On stop, fill missing worktype/module through `ProjectDefaultsStore` after project is known.
- Throw `project is required` if no explicit/resolved project exists when stopping.
- Throw `worktype is required` if no explicit/default worktype exists when stopping.
- Create a pending time entry when stopping and link it via `source_timer_id`.

**Step 4: Verify and commit**
Run:

```bash
npm run check
git add src/timer-store.ts src/time-entry-store.ts src/timer-service.ts tests/timer-service.test.ts
git commit -m "feat: manage multiple local timers"
```

## Task 10: Add direct time entry service and local query reporting

**Files:**
- Create: `src/time-service.ts`
- Create: `tests/time-service.test.ts`

**Step 1: Write tests**

Test:

- `addTime` uses project defaults when worktype/module omitted.
- `queryTime` supports `today`, `this_week`, `last_week`, `this_month`, `last_month`, `custom`.
- `queryTime` filters by project.
- Query service does not receive or call API.

Expected report shape:

```ts
{
  startDate: "2026-04-24",
  endDate: "2026-04-24",
  totalSeconds: 3600,
  entries: [...],
  byProject: [{ projectId: 10, projectName: "Website", totalSeconds: 3600 }]
}
```

**Step 2: Implement `src/time-service.ts`**

Implementation requirements:

- `addTime({ projectId, worktypeId?, moduleId?, date, durationSeconds, description?, billable? })`
- `queryTime({ range, start_date?, end_date?, projectId?, projectQuery?, now? })`
- If `projectQuery` is provided, resolve exactly one project via `CatalogStore.searchProjectContext` or throw ambiguity.
- Use `resolveDateRange` from `src/date-ranges.ts`.
- Join `time_entries` with catalog tables to include names.
- Never import or use `IntervalsApiClient` in this module.

**Step 3: Verify and commit**
Run:

```bash
npm run check
git add src/time-service.ts tests/time-service.test.ts
git commit -m "feat: add local time entry queries"
```

## Task 10A: Add time entry editing service

**Files:**
- Modify: `src/time-entry-store.ts`
- Modify: `src/time-service.ts`
- Create: `tests/time-editing.test.ts`

**Step 1: Write tests**

Test local-first editing for both unsynced and synced entries:

```ts
const entry = service.addTime({
  projectId: 10,
  worktypeId: 5,
  moduleId: 7,
  date: "2026-04-24",
  durationSeconds: 1800,
  description: "Initial",
});

const edited = service.editTime({
  localId: entry.localId,
  durationSeconds: 3600,
  description: "Revised implementation work",
});

assert.equal(edited.durationSeconds, 3600);
assert.equal(edited.description, "Revised implementation work");
assert.equal(edited.syncStatus, "pending");
```

Also test that editing a row with `remoteId` preserves the `remoteId` and marks `syncStatus` back to `pending`, so the sync service can issue `PUT time/{remoteId}/`.

**Step 2: Implement store update method**

`TimeEntryStore.updateTimeEntry(localId, patch)` should allow updates to:

- `projectId`
- `worktypeId`
- `moduleId`
- `date`
- `startAt`
- `endAt`
- `durationSeconds`
- `description`
- `billable`

Every successful edit must set `sync_status = 'pending'`, clear `last_sync_error`, and update `updated_at`.

**Step 3: Implement `TimeService.editTime`**

`src/time-service.ts` should expose:

```ts
editTime(input: {
  localId: string;
  projectId?: number;
  projectQuery?: string;
  worktypeId?: number;
  moduleId?: number | null;
  date?: string;
  startAt?: string | null;
  endAt?: string | null;
  durationSeconds?: number;
  description?: string | null;
  billable?: boolean;
})
```

If `projectQuery` is provided, resolve exactly one project locally. If the project changes and `worktypeId` is omitted, resolve the new project default worktype or throw `worktype is required`.

**Step 4: Verify and commit**
Run:

```bash
npm run check
git add src/time-entry-store.ts src/time-service.ts tests/time-editing.test.ts
git commit -m "feat: edit local time entries"
```

## Task 11: Add sync service for time entries

**Files:**
- Create: `src/sync-service.ts`
- Create: `tests/sync-service.test.ts`

**Step 1: Write tests**

Tests should use a fake API and local DB:

1. Pending unsynced time entry calls `api.createResource("time", payload)` and records remote ID.
2. Pending edited time entry with `remote_id` calls `api.updateResource("time", remoteId, payload)` and keeps the remote ID.
3. Failed API calls leave local rows present and set `sync_status = 'failed'` plus `last_sync_error`.

**Step 2: Implement payload mapping**

Time payload mapping from Intervals docs:

```ts
{
  projectid: entry.projectId,
  moduleid: entry.moduleId,
  worktypeid: entry.worktypeId,
  personid: configuredPersonIdOrUndefined,
  date: entry.date,
  time: entry.durationSeconds / 3600,
  description: entry.description,
  billable: entry.billable ? "t" : "f"
}
```

Important: Intervals `time` requires `personid` and `billable`; if the account accepts defaults, this can be configurable later. For this implementation, add optional `INTERVALS_PERSON_ID` / config `personId`. If missing, sync should fail with a clear setup error while preserving local rows.

**Step 3: Implement `src/sync-service.ts`**

- `syncPending({ timeRepo, api, personId, limit })`
- Process pending/failed time entries only.
- For pending entries with no `remoteId`, call `api.createResource("time", payload)`.
- For pending entries with `remoteId`, call `api.updateResource("time", remoteId, payload)`.
- Extract remote IDs from response using `id` or `time.id` patterns.
- One bad row should not stop the entire sync pass.
- Return summary `{ timeEntriesCreated, timeEntriesUpdated, failed }`.

**Step 4: Verify and commit**
Run:

```bash
npm run check
git add src/sync-service.ts tests/sync-service.test.ts
git commit -m "feat: sync pending intervals time entries"
```

## Task 12: Add extension runtime container

**Files:**
- Create: `src/runtime.ts`
- Modify: `src/index.ts`
- Create: `tests/runtime.test.ts`

**Step 1: Write tests**

Test that runtime initializes DB without prompting and reports setup status:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRuntime } from "../src/runtime.js";

test("runtime opens sqlite and reports missing credentials", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-intervals-runtime-"));
  try {
    const runtime = createRuntime({ env: { PI_INTERVALS_HOME: home } });
    assert.equal(runtime.status().credentialsConfigured, false);
    runtime.close();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

**Step 2: Implement runtime**

`src/runtime.ts` should wire:

- config paths
- db
- catalog/defaults/timer/time repos
- api client only if credentials exist
- services
- `status()`
- `close()`

Do not prompt in runtime creation.

**Step 3: Update `src/index.ts`**

For now:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createRuntime } from "./runtime.js";

export default function intervalsExtension(pi: ExtensionAPI) {
  const runtime = createRuntime();
  pi.on("session_shutdown", async () => runtime.close());
}
```

**Step 4: Verify and commit**
Run:

```bash
npm run check
git add src/runtime.ts src/index.ts tests/runtime.test.ts
git commit -m "feat: initialize intervals runtime"
```

## Task 13: Register agent tools

**Files:**
- Create: `src/tools.ts`
- Modify: `src/index.ts`
- Create: `tests/tools.test.ts`

**Step 1: Write tests with fake pi**

Create a fake `ExtensionAPI` object that captures registered tools. Verify all tool names are registered:

```ts
assert.deepEqual(toolNames.sort(), [
  "intervals_add_time",
  "intervals_edit_time",
  "intervals_find_project_context",
  "intervals_list_time",
  "intervals_list_timers",
  "intervals_query_time",
  "intervals_set_project_defaults",
  "intervals_start_timer",
  "intervals_stop_timer",
  "intervals_sync_now",
].sort());
```

**Step 2: Implement `src/tools.ts`**

Use `Type.Object` and `StringEnum` schemas.

Tool descriptions and behavior:

- `intervals_find_project_context`
  - Params: `{ query?: string, project_id?: number, limit?: number }`
  - Calls local catalog search only.

- `intervals_start_timer`
  - Params: `{ description: string, project_id?: number, project_query?: string, worktype_id?: number, module_id?: number, notes?: string }`
  - Writes a local-only active timer. Does not require project/worktype/module and does not sync a timer resource.

- `intervals_stop_timer`
  - Params: `{ timer_id: string, project_id?: number, project_query?: string, worktype_id?: number, module_id?: number, description?: string, billable?: boolean }`
  - Stops a local timer, resolves/captures missing classification, creates a pending time entry, then triggers time-entry sync.

- `intervals_add_time`
  - Params: `{ project_id: number, worktype_id?: number, module_id?: number, date: string, duration_minutes: number, description?: string, billable?: boolean }`
  - Converts minutes to seconds.

- `intervals_edit_time`
  - Params: `{ time_entry_id: string, project_id?: number, project_query?: string, worktype_id?: number, module_id?: number | null, date?: string, start_at?: string | null, end_at?: string | null, duration_minutes?: number, description?: string | null, billable?: boolean }`
  - Edits an existing local time entry, marks it pending, and triggers create/update sync depending on whether `remote_id` exists.

- `intervals_query_time`
  - Params: `{ range: enum, start_date?: string, end_date?: string, project_id?: number, project_query?: string }`
  - Local-only.

- `intervals_list_timers`
  - Params: `{ state?: "active" | "recent", limit?: number }`

- `intervals_list_time`
  - Params: `{ limit?: number }`

- `intervals_set_project_defaults`
  - Params: `{ project_id: number, worktype_id?: number, module_id?: number }`

- `intervals_sync_now`
  - Params: `{}`

Include `promptSnippet` and `promptGuidelines` that explicitly name each tool. Example guideline:

```ts
"Use intervals_query_time for reporting time; intervals_query_time is local-only and does not sync with Intervals."
```

**Step 3: Verify and commit**
Run:

```bash
npm run check
git add src/tools.ts src/index.ts tests/tools.test.ts
git commit -m "feat: register intervals agent tools"
```

## Task 14: Register slash commands

**Files:**
- Create: `src/commands.ts`
- Modify: `src/index.ts`
- Create: `tests/commands.test.ts`

**Step 1: Write registration test**

With fake pi, assert commands are registered:

```ts
[
  "intervals-setup",
  "intervals-sync-projects",
  "intervals-sync-now",
  "intervals-status",
  "intervals-timers",
  "intervals-time",
  "intervals-project-defaults",
]
```

**Step 2: Implement commands**

- `/intervals-setup`
  - If env credentials exist, show source `env` and do not write config.
  - Otherwise prompt `ctx.ui.input("Intervals API key:")`; optional `Intervals person ID` prompt.
  - Save config.
  - Initialize DB.
  - Run project sync.

- `/intervals-sync-projects`
  - Require credentials.
  - Call catalog sync.
  - Notify counts.

- `/intervals-sync-now`
  - Run sync service.

- `/intervals-status`
  - Notify or custom display: DB path, credential source, active timers, pending sync count, last project sync.

- `/intervals-timers`
  - Show active/recent timers compactly.

- `/intervals-time`
  - Parse args: default `today`; accept `today`, `this-week`, `last-week`, `this-month`, `last-month`, and `YYYY-MM-DD..YYYY-MM-DD`.
  - Also support an edit form such as `edit <time_entry_id> [field=value ...]` if command parsing remains simple; otherwise rely on the `intervals_edit_time` tool for editing in v1.

- `/intervals-project-defaults`
  - For first implementation, accept args: `<project_id> <worktype_id> [module_id]`.
  - Later can become interactive.

Check `ctx.hasUI` before interactive prompts; in non-interactive mode return useful notification/errors.

**Step 3: Verify and commit**
Run:

```bash
npm run check
git add src/commands.ts src/index.ts tests/commands.test.ts
git commit -m "feat: add intervals commands"
```

## Task 15: Add background sync loop

**Files:**
- Create: `src/background-sync.ts`
- Modify: `src/runtime.ts`
- Create: `tests/background-sync.test.ts`

**Step 1: Write tests**

Use fake timer controls if simple, or test directly that:

- `startBackgroundSync()` calls sync on interval.
- It does not run overlapping sync passes.
- `stop()` clears interval.

**Step 2: Implement loop**

`src/background-sync.ts`:

```ts
export function startBackgroundSync(options: { intervalMs: number; syncNow: () => Promise<unknown>; onError?: (error: unknown) => void }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await options.syncNow(); } catch (error) { options.onError?.(error); } finally { running = false; }
  };
  const handle = setInterval(tick, options.intervalMs);
  return { stop: () => clearInterval(handle), tick };
}
```

In runtime, start the loop on `session_start` or extension factory only if credentials exist. Default interval: 10 minutes. Allow config/env override later if desired.

**Step 3: Verify and commit**
Run:

```bash
npm run check
git add src/background-sync.ts src/runtime.ts tests/background-sync.test.ts
git commit -m "feat: retry intervals sync in background"
```

## Task 16: Add tool rendering and compact formatting helpers

**Files:**
- Create: `src/format.ts`
- Modify: `src/tools.ts`
- Modify: `src/commands.ts`
- Create: `tests/format.test.ts`

**Step 1: Write tests**

Test formatting:

- `formatDuration(3660) === "1h 1m"`
- report total and grouped project output.
- sync status shown for failed entries.

**Step 2: Implement formatting helpers**

Functions:

- `formatDuration(seconds)`
- `formatTimer(timer)`
- `formatTimeEntry(entry)`
- `formatTimeReport(report)`
- `formatSyncSummary(summary)`

Use these for tool `content` text and command notifications. Keep renderers optional; do not overbuild custom TUI components in v1.

**Step 3: Verify and commit**
Run:

```bash
npm run check
git add src/format.ts src/tools.ts src/commands.ts tests/format.test.ts
git commit -m "feat: format intervals results"
```

## Task 17: Add documentation and local usage instructions

**Files:**
- Create: `README.md`
- Modify: `docs/designs/2026-04-24-pi-intervals.md` only if implementation intentionally changes design.

**Step 1: Write README**

Include:

```md
# pi-intervals

A pi extension for local-first Intervals time tracking.

## Install / develop

npm install
npm run check
pi -e ./src/index.ts

## Configuration

- INTERVALS_API_KEY
- INTERVALS_BASE_URL
- INTERVALS_PERSON_ID
- PI_INTERVALS_HOME

Or run /intervals-setup.

## Commands

/intervals-setup
/intervals-sync-projects
/intervals-sync-now
/intervals-status
/intervals-timers
/intervals-time today
/intervals-project-defaults <project_id> <worktype_id> [module_id]

## Agent tools

List all intervals_* tools, including `intervals_edit_time`, and state that reports are local-only.
```

**Step 2: Verify and commit**
Run:

```bash
npm run check
git add README.md
git commit -m "docs: add pi-intervals usage"
```

## Task 18: Manual integration verification

**Files:**
- No code changes unless failures are found.

**Step 1: Run full automated checks**
Run:

```bash
npm run check
```

Expected: all tests and typecheck pass.

**Step 2: Load extension in pi**
Run from repo root:

```bash
pi -e ./src/index.ts
```

Expected:

- Extension loads without startup prompt.
- `/intervals-status` is available.
- Tools appear in available tool list for the agent.

**Step 3: Verify setup-required behavior without credentials**
In pi, run:

```text
/intervals-status
```

Expected: status says credentials are not configured and shows DB path. No credential value is printed.

**Step 4: Verify with temp home and fake/no network safeguards**
Run:

```bash
PI_INTERVALS_HOME=$(mktemp -d) pi -e ./src/index.ts
```

Expected: DB is created in temp home only.

**Step 5: Commit fixes if needed**
For any fix:

```bash
git add <files>
git commit -m "fix: address intervals integration issue"
```

## Task 19: Final verification before claiming complete

**Files:**
- No code changes unless failures are found.

**Step 1: Check git state**
Run:

```bash
git status --short
```

Expected: clean working tree, except intentionally untracked local files such as `.env` if created.

**Step 2: Run final checks**
Run:

```bash
npm run check
```

Expected: PASS.

**Step 3: Summarize implementation**
Prepare final response with:

- Files created/modified.
- Commands run and pass/fail status.
- Any known limitations, especially Intervals auth/person ID assumptions.
- How to use `/intervals-setup`, `/intervals-sync-projects`, and local query commands.

## Known Implementation Risks / Follow-ups

1. **Intervals auth details:** Auth is isolated in `src/intervals-api.ts`; verify against a real account. If API key must be username/password or a different Basic auth shape, update only this file and tests.
2. **Person ID:** Intervals `time` docs require `personid`; setup should support `INTERVALS_PERSON_ID` or config `personId`. If timer creation also requires person ID, failed sync must clearly say so while preserving local rows.
3. **Remote timer semantics:** Intervals timers are more task/general-timer oriented than local project/worktype/module timers. Keep local timer state authoritative; remote timer mirroring may be best-effort until confirmed with real API behavior.
4. **No local query sync:** Do not add implicit API calls to query/report tools.
5. **No custom TUI overbuild:** Start with compact text output and optional notifications; only add custom components after core behavior works.
