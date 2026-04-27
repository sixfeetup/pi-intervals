# pi-intervals Design

Date: 2026-04-24

## Goal

Develop a pi extension called `pi-intervals` that lets the agent track simple local timers and Intervals time entries while maintaining reliable local state. The extension should support lightweight timer capture, stopped-timer-to-time-entry creation, completed time entry editing, local reporting, project defaults, and background synchronization.

Relevant Intervals API resources:

- `timer` — https://www.myintervals.com/api/resource?r=timer
- `time` — https://www.myintervals.com/api/resource?r=time
- `client` — https://www.myintervals.com/api/resource?r=client
- `project` — https://www.myintervals.com/api/resource?r=project
- `projectworktype` — https://www.myintervals.com/api/resource?r=projectworktype
- `projectmodule` — https://www.myintervals.com/api/resource?r=projectmodule

## Approach

Use a hybrid local-first model:

1. Agent tools write timer/time changes to local SQLite immediately.
2. Timers are local capture only in v1; finalized time entries are synced to Intervals.
3. The extension attempts to mirror completed/edited time entries to Intervals.
4. Failed syncs remain locally pending/failed with retry metadata.
5. Background sync retries pending work while pi is running.
6. Local reporting/querying never calls the Intervals API.

This gives fast, reliable agent tools while still using Intervals as the final system of record.

## Storage

Use SQLite as the primary local store.

Default storage location:

```text
~/.pi/intervals/
  intervals.db
  config.json
```

Allow override with:

```text
PI_INTERVALS_HOME=/custom/path
```

Credential resolution order:

1. Environment variables, e.g. `INTERVALS_API_KEY`, optional `INTERVALS_BASE_URL`
2. Local config file in `PI_INTERVALS_HOME` or `~/.pi/intervals/config.json`
3. Setup-required error from tools/commands

`INTERVALS_BASE_URL` should default to the standard Intervals API base URL.

## Local Data Model

SQLite should store operational data and reference/catalog data.

Reference tables:

- `clients`
- `projects`
- `project_worktypes`
- `project_modules`

Operational tables:

- `timers`
  - local timer ID
  - short task description
  - optional project/worktype/module hints, if known at start time
  - start/stop timestamps
  - active/stopped state

- `time_entries`
  - local time entry ID
  - remote Intervals time ID, when known
  - source timer ID, if derived from a timer
  - project/worktype/module IDs
  - date/start/end/duration
  - notes
  - sync status and retry metadata

- `project_defaults`
  - project ID
  - default worktype ID
  - default module ID

- `settings`
  - setup state
  - last project/reference sync timestamp
  - non-secret configuration metadata

A separate sync queue may be used, or sync metadata may be embedded directly on time rows. The implementation should preserve enough status to retry safely and show useful errors. Local timer rows do not need sync metadata in v1.

## Reference Data Sync

Clients, projects, project worktypes, and project modules change rarely. They should be synced:

- during `/intervals-setup`
- manually via `/intervals-sync-projects`

`/intervals-sync-projects` syncs all reference data, not just projects.

Agent tools should use the local catalog to resolve human-friendly project context into Intervals IDs. Ambiguous matches should fail clearly rather than guessing.

## Agent Tools

Recommended custom tools:

- `intervals_find_project_context`
  - Search local clients/projects/worktypes/modules by name.
  - Helps the agent resolve IDs before tracking time.

- `intervals_start_timer`
  - Start a local timer with a simple description.
  - Project/worktype/module hints are optional and must not be required to begin timing.
  - Does not sync a timer resource in v1.

- `intervals_stop_timer`
  - Stop a specific active timer.
  - Requires timer ID or an unambiguous match.
  - Captures/resolves project, worktype, and optional module before producing a finalized time entry and syncing it.

- `intervals_add_time`
  - Add a completed time entry directly without using a timer.
  - Accept explicit worktype/module or use project defaults.

- `intervals_edit_time`
  - Edit an existing local time entry.
  - Mark edited entries pending so they are created or updated in Intervals during sync.

- `intervals_list_timers`
  - Show active and recent local timers.

- `intervals_list_time`
  - Show recent local time entries with sync status.

- `intervals_query_time`
  - Local-only reporting/querying by date range and filters.

- `intervals_set_project_defaults`
  - Configure default worktype/module for a project.

- `intervals_sync_now`
  - Manually retry pending time-entry sync work.

## Commands

Recommended slash commands:

- `/intervals-setup`
  - Prompt for or validate credentials.
  - Initialize SQLite.
  - Run initial reference sync equivalent to `/intervals-sync-projects`.

- `/intervals-sync-projects`
  - Refresh clients, projects, project worktypes, and project modules.

- `/intervals-sync-now`
  - Retry pending time-entry sync operations.

- `/intervals-status`
  - Show DB path, credential source, active timer count, pending sync count, last project sync, and recent sync errors.

- `/intervals-timers`
  - Display active/recent timers.

- `/intervals-time`
  - Display compact local reports, accepting ranges such as `today`, `last-week`, or explicit date spans.
  - Optionally support simple time entry editing syntax; the agent tool is the primary v1 editing path.

- `/intervals-project-defaults`
  - View or edit default worktype/module per project.

## Multiple Timers

The extension must allow multiple active timers.

Timer operations should use explicit timer IDs where possible. Starting a timer requires only a description. If the user/agent references a timer by description or optional project hint, the tool may resolve it only when unambiguous. If multiple active timers match, the tool should fail with an ambiguity response listing candidates.

## Project Defaults

Users should be able to define default worktype and module per project.

When stopping timers, adding time, or editing time:

- explicit worktype/module parameters override defaults
- project default worktype/module are used when explicit values are omitted after a project is known
- worktype is required unless a project default exists
- module is optional unless later configured as required for a project

## Local-Only Time Queries

Reporting/querying must be local-only. `intervals_query_time` and `/intervals-time` should never call the Intervals API.

Supported ranges:

- `today`
- `this_week`
- `last_week`
- `this_month`
- `last_month`
- `custom` with `start_date` and `end_date`

Supported filters:

- project ID or project search text
- optionally client/worktype/module filters in later expansion

Results should include:

- total duration
- grouped entries, ideally by day and/or project
- notes
- project/worktype/module names
- local and remote IDs where useful
- sync status and errors when relevant

## Sync Lifecycle

Use mutation-triggered sync plus conservative periodic background retry.

After `stop_timer`, `add_time`, or `edit_time`:

1. Commit local SQLite changes first.
2. Attempt to sync the affected time entry to Intervals.
3. On success, record remote ID, sync status, and timestamps.
4. On failure, preserve local data and store error/retry metadata.

`start_timer` commits only a local timer row and does not perform network sync in v1.

A background loop should retry pending/failed sync work while pi is running, defaulting to a conservative interval such as 5–15 minutes. It should avoid noisy UI and never be triggered by local query/report tools.

Manual sync remains available through `/intervals-sync-now` and `intervals_sync_now`.

## Guardrails and Constraints

- Only wrap the required Intervals resources: `time`, `client`, `project`, `projectworktype`, `projectmodule`; keep `timer` isolated for future compatibility if implemented, but do not depend on it in v1 workflows.
- Agent tools should not expose raw API mechanics.
- Ambiguous project/worktype/module/timer resolution must fail clearly.
- Multiple active timers are allowed.
- Stopping requires a timer ID or an unambiguous timer match.
- Project is required for tracked time.
- Worktype is required unless project defaults provide one.
- Module can be optional unless project policy/defaults later make it required.
- Local records must never be deleted because remote sync fails.
- Sync errors should be visible but must not leak credentials.
- Querying/reporting must be local-only.
- Setup should be explicit; extension load should not prompt automatically.

## Success Criteria

- User can run `/intervals-setup`, configure credentials, initialize SQLite, and sync reference data.
- User can refresh all clients/projects/worktypes/modules via `/intervals-sync-projects`.
- Agent can find project context from the local catalog.
- Agent can start multiple timers with simple descriptions and stop/apply a selected timer into a full time entry.
- Agent can add completed time entries directly.
- Agent can edit existing time entries and retry sync without losing local edits.
- Agent can use project defaults for worktype/module.
- Timer and time mutations are persisted locally before any network sync.
- Failed syncs are retried by `/intervals-sync-now` and a conservative background loop.
- User/agent can query local time for today, this week, last week, this month, last month, custom ranges, and per project.
- Local queries do not call the Intervals API.
