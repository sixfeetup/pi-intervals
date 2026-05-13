# Start Timer `start_at` Design

## Goal

Allow agents to start a local Intervals timer with a user-specified local wall-clock start time, primarily for requests like “start a timer for X at 9:30”.

## Scope

Add an optional `start_at` parameter to `intervals_start_timer`. The existing no-argument timing behavior remains unchanged: if `start_at` is omitted, the timer starts at the current time.

## Accepted Input

`start_at` accepts three forms:

- `HH:mm` or `H:mm`: today at that local wall-clock time.
- `YYYY-MM-DD HH:mm`: that local date and wall-clock time.
- ISO datetime strings accepted by JavaScript `Date`: exact datetime, including timezone/offset when supplied.

## Validation

Invalid formats fail with a clear error such as `invalid start_at: <value>`. Parsed start times later than the tool execution time are rejected to avoid active timers with negative elapsed duration. For tests and internal calls, this comparison should use an injectable reference `Date`.

## Architecture

`TimerService.startTimer` already accepts an internal `now?: Date` and stores `startedAt = now.toISOString()`. The public tool will parse `start_at` into a `Date` and pass it as `now`. No database schema change is required.

A small parsing helper should live outside the tool registration body so it can be unit-tested and reused without making `src/tools.ts` more complex.

## Data Flow

1. Agent calls `intervals_start_timer({ description, start_at })`.
2. Tool parses `start_at` if provided; otherwise it leaves `now` undefined.
3. `TimerService.startTimer` stores the chosen start timestamp in `timers.started_at`.
4. `intervals_stop_timer` continues to calculate duration from `timer.startedAt`, so derived time entries automatically use the requested start time.

## Testing

Add tests for:

- `HH:mm` local wall-clock parsing.
- `YYYY-MM-DD HH:mm` local date/time parsing.
- ISO datetime parsing.
- invalid `start_at` rejection.
- future `start_at` rejection.
- the start timer tool passing parsed `start_at` to `TimerService.startTimer`.

## Documentation

Update README/tool documentation to mention the optional `start_at` parameter and local wall-clock semantics.
