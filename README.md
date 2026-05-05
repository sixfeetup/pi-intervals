# pi-intervals

A pi extension for local-first Intervals time tracking.

Timers and time entries are captured in a local SQLite database first, then
synced to Intervals in the background or on demand. Queries and reports are
always local-only and never call the Intervals API.

## Install

Install the extension as a pi package from GitHub:

```bash
pi install git:git@github.com:sixfeetup/pi-intervals.git
```

Then start pi normally and run `/intervals-setup` to configure your Intervals
credentials and sync the project catalog.

## Configuration

Credentials and settings are resolved in this order:

1. Environment variables
2. `config.json` inside `PI_INTERVALS_HOME` (or `~/.pi/intervals/`)

### Environment variables

| Variable              | Description                                                      |
| --------------------- | ---------------------------------------------------------------- |
| `INTERVALS_API_KEY`   | Intervals API key for HTTP Basic auth                            |
| `INTERVALS_BASE_URL`  | Intervals API base URL (default: `https://api.myintervals.com/`) |
| `INTERVALS_PERSON_ID` | Your Intervals person ID (required for time-entry sync)          |
| `PI_INTERVALS_HOME`   | Override the default local storage path (`~/.pi/intervals/`)     |

### `config.json` keys

If you prefer file-based configuration, create `config.json` inside `PI_INTERVALS_HOME` (or `~/.pi/intervals/`):

| Key              | Type     | Description                                                      |
| ---------------- | -------- | ---------------------------------------------------------------- |
| `apiKey`         | `string` | Intervals API key for HTTP Basic auth                            |
| `baseUrl`        | `string` | Intervals API base URL (default: `https://api.myintervals.com/`) |
| `personId`       | `number` | Your Intervals person ID (required for time-entry sync)          |
| `syncIntervalMs` | `number` | Background sync interval in milliseconds                         |

### Interactive setup

Run `/intervals-setup` inside pi to save credentials to the local config file and perform an initial project catalog sync.

## How it works

- **Timers are local-only.** Starting a timer writes a lightweight local row
  with just a description. Project, worktype, and module hints are optional.
- **Running timers can be reclassified locally.** Edit a timer's project,
  worktype, or module hints before stopping it; the updated classification is
  applied when the time entry is created.
- **Stop/apply creates a time entry.** When you stop a timer, you provide (or
  resolve) the project and worktype. The extension creates a pending time entry
  and immediately tries to sync it to Intervals.
- **Time entries are local-first.** `intervals_add_time`, `intervals_edit_time`,
  and `intervals_stop_timer` all persist to SQLite before any network call. If
  sync fails, the entry stays local with a `failed` or `pending` status and can
  be retried.
- **Catalog sync stores active rows.** Project sync fetches all catalog pages,
  keeps active projects and active classifications, and retains clients
  referenced by active projects.
- **Reports are local-only.** `query_time` and `/intervals-time` read from
  SQLite and never call the Intervals API.

## Slash commands

| Command                                                                                      | Description                                                                                                           |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/intervals-setup`                                                                           | Configure credentials and run initial project sync                                                                    |
| `/intervals-sync-projects`                                                                   | Refresh local catalog of clients, projects, worktypes, and modules                                                    |
| `/intervals-sync-now`                                                                        | Retry pending time-entry sync immediately                                                                             |
| `/intervals-status`                                                                          | Show DB path, credential source, active timers, pending sync count, and last project sync                             |
| `/intervals-timers [recent]`                                                                 | Show bright, compact active timers or recently stopped timers                                                         |
| `/intervals-timers edit <timer_id> [project_id=...] [worktype_id=...] [module_id=...\|null] [description=...]` | Update description or classification hints on a running timer                                                         |
| `/intervals-timers delete <timer_id>`                                                        | Safely delete an active timer or stopped timer with no linked time entry                                              |
| `/intervals-time <range>`                                                                    | Query local time entries by range or date                                                                             |
| `/intervals-time edit <id> [field=value ...]`                                                | Edit a local time entry from the command line                                                                         |
| `/intervals-project-defaults <project_id> <worktype_id> [module_id]`                         | Set default worktype and module for a project                                                                         |

### `/intervals-time` notes

- Time-entry rows start with the local short time entry ID used by `/intervals-time edit` and `intervals_edit_time`.
- Use `stop_time=HH:mm` for local stop-time changes; this updates the stored end time and recalculates rounded duration together.
- Supported ranges: `today`, `yesterday`, `this-week`, `last-week`, `this-month`, `last-month`, `YYYY-MM-DD`, and `YYYY-MM-DD..YYYY-MM-DD`.

## Agent tools

| Tool                             | Description                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `intervals_find_project_context` | Search the local project catalog for IDs and classifications (local-only)           |
| `intervals_start_timer`          | Start a local timer with a simple description; project/worktype/module are optional |
| `intervals_stop_timer`           | Stop a timer, resolve classification, create a pending time entry, and sync         |
| `intervals_edit_timer`           | Update description or project/worktype/module hints on a running local timer        |
| `intervals_delete_timer`         | Safely delete an active timer or stopped timer with no linked time entry            |
| `intervals_add_time`             | Add a completed time entry directly (duration in minutes)                           |
| `intervals_edit_time`            | Edit an existing local time entry by short ID or linked timer ID; use `stop_time` for local stop-time changes that recalculate duration |
| `intervals_query_time`           | Report time entries by date range and project filter (local-only)                   |
| `intervals_list_timers`          | List active or recent local timers                                                  |
| `intervals_lookup_time_entry`    | Map a stopped local timer ID to the linked local time entry ID                      |
| `intervals_list_time`            | List recent local time entries with sync status                                     |
| `intervals_set_project_defaults` | Configure default worktype/module for a project                                     |
| `intervals_sync_now`             | Immediately retry syncing pending time entries to Intervals                         |
