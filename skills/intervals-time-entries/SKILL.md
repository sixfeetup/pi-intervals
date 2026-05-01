---
name: intervals-time-entries
description: Use when starting, stopping, editing, syncing, reviewing, or retroactively adding Intervals timers or time entries.
---

# Intervals Time Entries

## Overview

Time entry classification should be history-guided, not guess-driven. Before creating or changing timers/time entries, inspect recent local timers and time entries, use similar prior work to choose project/worktype/module, and only ask the user when history and context cannot resolve ambiguity.

## When to Use

Use this skill for any request involving Intervals time tracking, including:

- starting a timer, e.g. “add timer for FOU-406” or “start a timer for Clubhouse”
- stopping or editing a timer
- adding retroactive time entries
- fixing failed syncs
- reviewing recent time entries or answering “what did I log?”
- choosing project, worktype, or module for time tracking

## Required Context Check

Always gather context before creating, editing, or syncing a time entry or timer:

1. Check recent time entries with `intervals_list_time`.
2. Check active/recent timers with `intervals_list_timers` when the request involves timers or could be affected by an active timer.
3. Use `intervals_query_time` for date-scoped requests such as “today”, “yesterday”, “this week”, or when recent entries are not enough.
4. Use `intervals_find_project_context` to resolve project names, ticket prefixes, worktypes, modules, and ambiguous project matches.
5. Use the current working directory and path as an additional clue. For example, if the user is working under a client/project repo, prefer recent entries and project matches related to that repo.

Do not skip the recent-entry check just because the user supplied a ticket key or project name.

## Classification Process

### 1. Match against recent history first

Look for recent entries/timers with the same or similar:

- ticket prefix or ticket key, e.g. `FOU-406`, `FOU-*`
- project code, e.g. `CLBH005-NS`
- client/project name, e.g. `Clubhouse`
- repo/path clue from the current directory
- description pattern, e.g. “FOU-406: Fix mypy 1.20.2 upgrade type-check failures”

If a recent matching entry exists, reuse its:

- project ID
- worktype ID
- module ID, including leaving it blank if the prior matching entry was blank
- description style, unless the user provided a more specific description

Example: if the user says “add timer for FOU-406” and a recent entry says:

```text
CLBH005-NS ... /foundations (Consulting) | FOU-406: Fix mypy 1.20.2 upgrade type-check failures
```

start the timer with the same project, worktype, and module, and use the same ticket description style.

### 2. Resolve ambiguity with history and path clues

If a project name is ambiguous, prefer the most likely recent match rather than asking immediately.

Example: if “Clubhouse” matches both `CLBH005-NS` and `CLBH006-NS`, inspect recent entries. If recent work is on `CLBH005-NS` with the same ticket prefix or repo/path context, use `CLBH005-NS` and state that it was chosen based on recent matching entries.

Ask a clarification question only when:

- there is no recent/history/path signal,
- multiple candidates have equally strong recent matches, or
- the choice could materially change billing/client classification.

Ask one concise question and include the leading candidates.

### 3. New project handling

A “new project” means there is no sufficiently similar recent time entry/timer for the project/worktype/module combination.

When starting a timer for a new project:

1. Start the timer promptly if the description is clear; do not block timer start solely because defaults are unknown.
2. Resolve project/worktype/module as far as possible from `intervals_find_project_context` and path clues.
3. Ask the user whether they want to set default worktype and module for that project, especially if they had to choose them manually.
4. If the user confirms, call `intervals_set_project_defaults` with the confirmed worktype/module.

For retroactive entries, resolve required project/worktype before creating the entry. If worktype/module cannot be inferred safely, ask before adding the entry.

## Tool Guidelines

- Use `intervals_start_timer` for new active work. Include project/worktype/module hints when confidently inferred from recent history.
- Use `intervals_stop_timer` when the user finishes work. Re-check recent entries if classification is missing or stale.
- Use `intervals_add_time` for retroactive entries. Convert durations to minutes.
- Use `intervals_edit_time` to fix failed or incorrect entries, then verify with `intervals_list_time` or `intervals_query_time`.
- Use `intervals_sync_now` after adding/editing/stopping if the tool did not already sync, or when the user explicitly asks to retry sync.
- Use `intervals_find_project_context` before relying on a project/worktype/module ID that came from text rather than a previous time entry.

## ID Safety

Be careful with local catalog row IDs versus Intervals remote IDs.

- Prefer IDs returned directly by `intervals_find_project_context` and IDs shown in synced/recent time-entry tool output.
- If sync fails with an “Invalid worktype_id” or “local catalog row id” error, correct the entry using the Intervals worktype/module IDs suggested by the error or by `intervals_find_project_context`, then retry sync.
- Do not reuse raw database IDs unless the tools identify them as valid Intervals IDs.

## Response Pattern

When you create, edit, or start a timer/time entry, briefly report:

- what was created or changed
- the selected project/worktype/module
- why that classification was chosen, e.g. “matched recent FOU-406 entry” or “matched current repo path”
- sync status, when applicable

Keep the response concise.

## Common Mistakes

- Starting a timer from only the ticket key without checking recent entries.
- Asking the user to disambiguate before checking history and current path.
- Forgetting to preserve the module from similar prior work.
- Using a local catalog row ID where Intervals expects a remote worktype/module ID.
- Setting project defaults without explicit user confirmation.
