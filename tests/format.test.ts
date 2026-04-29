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

test("formatTimeReport renders total and grouped projects", () => {
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
      { projectId: 10, projectName: "Website", totalSeconds: 3600 },
      { projectId: 20, projectName: "API", totalSeconds: 1800 },
    ],
  };
  const text = formatTimeReport(report);
  assert.ok(text.includes("Total: 1h 30m"));
  assert.ok(text.includes("Website: 1h"));
  assert.ok(text.includes("API: 30m"));
  assert.ok(text.includes("Homepage"));
  assert.ok(text.includes("Auth endpoint"));
});

test("formatSyncSummary renders compact counts", () => {
  const summary: SyncPendingResult = {
    timeEntriesCreated: 3,
    timeEntriesUpdated: 1,
    failed: 2,
  };
  assert.equal(formatSyncSummary(summary), "created=3 updated=1 failed=2");
});
