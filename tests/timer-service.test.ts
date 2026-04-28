import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { TimerStore } from "../src/timer-store.js";
import { TimeEntryStore } from "../src/time-entry-store.js";
import { ProjectDefaultsStore } from "../src/project-defaults-store.js";
import { CatalogStore } from "../src/catalog-store.js";
import { TimerService } from "../src/timer-service.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pi-intervals-timer-"));
  const db = openDatabase(join(dir, "intervals.db"));
  const timerStore = new TimerStore(db);
  const timeEntryStore = new TimeEntryStore(db);
  const defaultsStore = new ProjectDefaultsStore(db);
  const catalogStore = new CatalogStore(db);
  const service = new TimerService(timerStore, timeEntryStore, defaultsStore, catalogStore);
  return { dir, db, timerStore, timeEntryStore, service, defaultsStore };
}

function teardown(dir: string, db: ReturnType<typeof openDatabase>) {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

test("startTimer requires only description and creates active timer", () => {
  const { dir, db, timerStore, service } = setup();
  try {
    const timer = service.startTimer({ description: "Work on feature", now: new Date("2026-04-24T10:00:00Z") });
    assert.ok(timer.localId);
    assert.equal(timer.description, "Work on feature");
    assert.equal(timer.state, "active");
    assert.equal(timer.projectId, undefined);
    assert.equal(timer.worktypeId, undefined);
    assert.equal(timer.moduleId, undefined);

    const active = timerStore.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].localId, timer.localId);
  } finally {
    teardown(dir, db);
  }
});

test("startTimer accepts optional project/worktype/module hints", () => {
  const { dir, db, service } = setup();
  try {
    const timer = service.startTimer({
      description: "Work",
      projectId: 10,
      worktypeId: 5,
      moduleId: 7,
      now: new Date("2026-04-24T10:00:00Z"),
    });
    assert.equal(timer.projectId, 10);
    assert.equal(timer.worktypeId, 5);
    assert.equal(timer.moduleId, 7);
  } finally {
    teardown(dir, db);
  }
});

test("multiple active timers are allowed", () => {
  const { dir, db, service } = setup();
  try {
    const first = service.startTimer({ description: "A", now: new Date("2026-04-24T10:00:00Z") });
    const second = service.startTimer({ description: "B", now: new Date("2026-04-24T11:00:00Z") });
    const active = service.listActive();
    assert.equal(active.length, 2);
    assert.ok(active.find((t) => t.localId === first.localId));
    assert.ok(active.find((t) => t.localId === second.localId));
  } finally {
    teardown(dir, db);
  }
});

test("stopTimer by localId creates pending time entry and stops timer", () => {
  const { dir, db, timerStore, timeEntryStore, service } = setup();
  try {
    const first = service.startTimer({ description: "A", now: new Date("2026-04-24T10:00:00Z") });
    const second = service.startTimer({ description: "B", now: new Date("2026-04-24T11:00:00Z") });

    const entry = service.stopTimer({
      localId: first.localId,
      projectId: 10,
      worktypeId: 5,
      moduleId: 7,
      now: new Date("2026-04-24T10:30:00Z"),
    });

    assert.equal(timerStore.listActive().length, 1);
    assert.equal(timerStore.listActive()[0].localId, second.localId);

    const timer = timerStore.getTimer(first.localId);
    assert.equal(timer?.state, "stopped");
    assert.equal(timer?.elapsedSeconds, 1800);
    assert.equal(timer?.stoppedAt, "2026-04-24T10:30:00.000Z");

    assert.equal(entry.projectId, 10);
    assert.equal(entry.worktypeId, 5);
    assert.equal(entry.moduleId, 7);
    assert.equal(entry.durationSeconds, 1800);
    assert.equal(entry.date, "2026-04-24");
    assert.equal(entry.sourceTimerId, first.localId);
    assert.equal(entry.syncStatus, "pending");
    assert.equal(entry.description, "A");
    assert.equal(entry.startAt, first.startedAt);
    assert.equal(entry.endAt, "2026-04-24T10:30:00.000Z");
  } finally {
    teardown(dir, db);
  }
});

test("stopTimer requires project", () => {
  const { dir, db, service } = setup();
  try {
    const timer = service.startTimer({ description: "A", now: new Date("2026-04-24T10:00:00Z") });
    assert.throws(() => {
      service.stopTimer({ localId: timer.localId, now: new Date("2026-04-24T10:30:00Z") });
    }, /project is required/);
  } finally {
    teardown(dir, db);
  }
});

test("stopTimer requires worktype", () => {
  const { dir, db, service } = setup();
  try {
    const timer = service.startTimer({ description: "A", now: new Date("2026-04-24T10:00:00Z") });
    assert.throws(() => {
      service.stopTimer({ localId: timer.localId, projectId: 10, now: new Date("2026-04-24T10:30:00Z") });
    }, /worktype is required/);
  } finally {
    teardown(dir, db);
  }
});

test("stopTimer uses project defaults for missing worktype/module", () => {
  const { dir, db, service, defaultsStore } = setup();
  try {
    defaultsStore.setProjectDefaults({ projectId: 10, defaultWorktypeId: 5, defaultModuleId: 7 });

    const timer = service.startTimer({ description: "A", now: new Date("2026-04-24T10:00:00Z") });
    const entry = service.stopTimer({
      localId: timer.localId,
      projectId: 10,
      now: new Date("2026-04-24T10:30:00Z"),
    });

    assert.equal(entry.worktypeId, 5);
    assert.equal(entry.moduleId, 7);
  } finally {
    teardown(dir, db);
  }
});

test("stopTimer uses timer hints when stop params omitted", () => {
  const { dir, db, service, defaultsStore } = setup();
  try {
    defaultsStore.setProjectDefaults({ projectId: 10, defaultWorktypeId: 99 });

    const timer = service.startTimer({
      description: "A",
      projectId: 10,
      worktypeId: 5,
      moduleId: 7,
      now: new Date("2026-04-24T10:00:00Z"),
    });
    const entry = service.stopTimer({
      localId: timer.localId,
      now: new Date("2026-04-24T10:30:00Z"),
    });

    assert.equal(entry.projectId, 10);
    assert.equal(entry.worktypeId, 5);
    assert.equal(entry.moduleId, 7);
  } finally {
    teardown(dir, db);
  }
});

test("stopTimer allows overriding timer hints at stop time", () => {
  const { dir, db, service } = setup();
  try {
    const timer = service.startTimer({
      description: "A",
      projectId: 10,
      worktypeId: 5,
      moduleId: 7,
      now: new Date("2026-04-24T10:00:00Z"),
    });
    const entry = service.stopTimer({
      localId: timer.localId,
      projectId: 20,
      worktypeId: 6,
      now: new Date("2026-04-24T10:30:00Z"),
    });

    assert.equal(entry.projectId, 20);
    assert.equal(entry.worktypeId, 6);
    assert.equal(entry.moduleId, undefined);
  } finally {
    teardown(dir, db);
  }
});

test("stopTimer uses default module but explicit worktype when only worktype provided", () => {
  const { dir, db, service, defaultsStore } = setup();
  try {
    defaultsStore.setProjectDefaults({ projectId: 10, defaultWorktypeId: 99, defaultModuleId: 7 });

    const timer = service.startTimer({ description: "A", now: new Date("2026-04-24T10:00:00Z") });
    const entry = service.stopTimer({
      localId: timer.localId,
      projectId: 10,
      worktypeId: 5,
      now: new Date("2026-04-24T10:30:00Z"),
    });

    assert.equal(entry.worktypeId, 5);
    assert.equal(entry.moduleId, 7);
  } finally {
    teardown(dir, db);
  }
});

test("stopTimer accepts optional description and billable override", () => {
  const { dir, db, service } = setup();
  try {
    const timer = service.startTimer({ description: "A", now: new Date("2026-04-24T10:00:00Z") });
    const entry = service.stopTimer({
      localId: timer.localId,
      projectId: 10,
      worktypeId: 5,
      description: "Updated description",
      billable: false,
      now: new Date("2026-04-24T10:30:00Z"),
    });

    assert.equal(entry.description, "Updated description");
    assert.equal(entry.billable, false);
  } finally {
    teardown(dir, db);
  }
});
