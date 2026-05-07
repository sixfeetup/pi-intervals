import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDuration,
  formatTimer,
  formatTimeEntry,
  formatTimeReport,
  formatSyncSummary,
} from "../src/format.js";
import type { Timer } from "../src/timer-store.js";
import type { TimeEntry } from "../src/time-entry-store.js";
import type { TimeReport } from "../src/time-service.js";
import type { SyncPendingResult } from "../src/sync-service.js";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

test("formatDuration renders hours and minutes compactly", () => {
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(59), "0m");
  assert.equal(formatDuration(60), "1m");
  assert.equal(formatDuration(3660), "1h 1m");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(7200), "2h");
  assert.equal(formatDuration(150), "2m");
});

test("formatTimer renders active timer using current elapsed time", () => {
  const timer: Timer = {
    localId: "abc12345-0000-0000-0000-000000000000",
    description: "Design review",
    startedAt: "2026-04-24T10:00:00Z",
    elapsedSeconds: 0,
    state: "active",
    createdAt: "2026-04-24T10:00:00Z",
    updatedAt: "2026-04-24T10:00:00Z",
  };
  assert.equal(formatTimer(timer, new Date("2026-04-24T11:01:00Z")), "abc12345 active 1h 1m Design review");
});

test("formatTimer renders stopped timer compactly", () => {
  const timer: Timer = {
    localId: "def67890-0000-0000-0000-000000000000",
    description: "Bug fix",
    startedAt: "2026-04-24T09:00:00Z",
    stoppedAt: "2026-04-24T09:30:00Z",
    elapsedSeconds: 1800,
    state: "stopped",
    createdAt: "2026-04-24T09:00:00Z",
    updatedAt: "2026-04-24T09:30:00Z",
  };
  assert.equal(formatTimer(timer), "def67890 stopped 30m Bug fix");
});

test("formatTimeEntry renders compactly with sync status", () => {
  const entry: TimeEntry = {
    localId: "entry-1111-0000-0000-000000000000",
    projectId: 10,
    worktypeId: 5,
    date: "2026-04-24",
    durationSeconds: 3600,
    billable: true,
    syncStatus: "synced",
    syncAttempts: 0,
    createdAt: "2026-04-24T10:00:00Z",
    updatedAt: "2026-04-24T10:00:00Z",
  };
  const formatted = formatTimeEntry({ ...entry, projectName: "Website", worktypeName: "Development" });
  assert.ok(formatted.includes("2026-04-24"));
  assert.ok(formatted.includes("1h"));
  assert.ok(formatted.includes("Website"));
  assert.ok(formatted.includes("Development"));
  assert.ok(formatted.includes("synced"));
});

test("formatTimeEntry shows failed status and last error", () => {
  const entry: TimeEntry = {
    localId: "entry-2222-0000-0000-000000000000",
    projectId: 10,
    worktypeId: 5,
    date: "2026-04-24",
    durationSeconds: 1800,
    billable: true,
    syncStatus: "failed",
    syncAttempts: 2,
    lastSyncError: "Network timeout",
    createdAt: "2026-04-24T10:00:00Z",
    updatedAt: "2026-04-24T10:00:00Z",
  };
  const formatted = formatTimeEntry({ ...entry, projectName: "Website", worktypeName: "Development" });
  assert.ok(formatted.includes("failed"));
  assert.ok(formatted.includes("Network timeout"));
});

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

test("formatTimeEntry shows legacy full local ids without slicing", () => {
  const entry: TimeEntry = {
    localId: "4ee96f17-0374-4d1b-a92a-05956213a007",
    projectId: 67184,
    worktypeId: 118848,
    date: "2026-05-05",
    startAt: "07:07",
    endAt: "08:35",
    durationSeconds: 5400,
    billable: true,
    syncStatus: "pending",
    syncAttempts: 0,
    createdAt: "2026-05-05T07:07:43.897Z",
    updatedAt: "2026-05-05T08:35:00.000Z",
  };

  const formatted = formatTimeEntry({
    ...entry,
    projectName: "SFUP001 - System Administration",
    worktypeName: "Development",
  });

  assert.ok(formatted.startsWith(`${entry.localId} 2026-05-05 07:07-08:35 1h 30m`), formatted);
});

test("formatTimeReport renders project-first totals with nested entries for a day", () => {
  const report: TimeReport = {
    startDate: "2026-04-24",
    endDate: "2026-04-24",
    totalSeconds: 5400,
    entries: [
      {
        localId: "e1",
        projectId: 10,
        worktypeId: 5,
        date: "2026-04-24",
        startAt: "09:00",
        endAt: "10:00",
        durationSeconds: 3600,
        billable: true,
        syncStatus: "synced",
        syncAttempts: 0,
        createdAt: "2026-04-24T10:00:00Z",
        updatedAt: "2026-04-24T10:00:00Z",
        projectName: "Website",
        worktypeName: "Development",
        description: "Homepage",
      },
      {
        localId: "e2",
        projectId: 20,
        worktypeId: 6,
        date: "2026-04-24",
        startAt: "12:00",
        endAt: "12:30",
        durationSeconds: 1800,
        billable: true,
        syncStatus: "pending",
        syncAttempts: 0,
        createdAt: "2026-04-24T12:00:00Z",
        updatedAt: "2026-04-24T12:00:00Z",
        projectName: "API",
        worktypeName: "Design",
        description: "Auth endpoint",
      },
    ],
    byProject: [
      { projectId: 20, projectName: "API", totalSeconds: 1800 },
      { projectId: 10, projectName: "Website", totalSeconds: 3600 },
    ],
  };

  const text = stripAnsi(formatTimeReport(report, { label: "today" }));

  assert.match(text, /^today\s+2026-04-24 .*Total: 1h 30m .*2 entries .*2 projects/);
  assert.ok(text.indexOf("Website") < text.indexOf("API"), text);
  assert.match(text, /Website.*1h/);
  assert.match(text, /API.*30m/);
  assert.match(text, /e1\s+09:00-10:00\s+1h\s+✓ Homepage/);
  assert.match(text, /e2\s+12:00-12:30\s+30m\s+● Auth endpoint/);
  assert.ok(!text.includes("e1 2026-04-24"), text);
});

test("formatTimeReport includes entry dates for multi-day ranges", () => {
  const report: TimeReport = {
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    totalSeconds: 5400,
    entries: [
      {
        localId: "e1",
        projectId: 10,
        worktypeId: 5,
        date: "2026-04-03",
        startAt: "09:00",
        endAt: "10:00",
        durationSeconds: 3600,
        billable: true,
        syncStatus: "synced",
        syncAttempts: 0,
        createdAt: "2026-04-03T10:00:00Z",
        updatedAt: "2026-04-03T10:00:00Z",
        projectName: "Website",
        worktypeName: "Development",
        description: "Homepage",
      },
      {
        localId: "e2",
        projectId: 10,
        worktypeId: 5,
        date: "2026-04-24",
        startAt: "12:00",
        endAt: "12:30",
        durationSeconds: 1800,
        billable: true,
        syncStatus: "failed",
        syncAttempts: 2,
        lastSyncError: "Network timeout",
        createdAt: "2026-04-24T12:00:00Z",
        updatedAt: "2026-04-24T12:00:00Z",
        projectName: "Website",
        worktypeName: "Development",
        description: "Auth endpoint",
      },
    ],
    byProject: [
      { projectId: 10, projectName: "Website", totalSeconds: 5400 },
    ],
  };

  const text = stripAnsi(formatTimeReport(report));

  assert.match(text, /2026-04-01 \.\. 2026-04-30 .*Total: 1h 30m/);
  assert.match(text, /e1\s+2026-04-03\s+09:00-10:00\s+1h\s+✓ Homepage/);
  assert.match(text, /e2\s+2026-04-24\s+12:00-12:30\s+30m\s+✕ Auth endpoint \(Network timeout\)/);
});

test("formatSyncSummary renders compact counts", () => {
  const summary: SyncPendingResult = {
    timeEntriesCreated: 3,
    timeEntriesUpdated: 1,
    failed: 2,
  };
  assert.equal(formatSyncSummary(summary), "created=3 updated=1 failed=2");
});
