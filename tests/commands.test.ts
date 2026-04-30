import assert from "node:assert/strict";
import test from "node:test";
import { registerIntervalsCommands } from "../src/commands.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

interface FakeCommand {
  name: string;
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

function fakePi(): { pi: ExtensionAPI; commands: FakeCommand[] } {
  const commands: FakeCommand[] = [];
  const pi = {
    registerCommand: (name: string, options: { description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => {
      commands.push({ name, description: options.description, handler: options.handler });
    },
  } as unknown as ExtensionAPI;
  return { pi, commands };
}

function fakeCtx(options: { hasUI?: boolean; inputs?: string[] } = {}): ExtensionCommandContext & { notifications: Array<{ message: string; type: string }> } {
  const notifications: Array<{ message: string; type: string }> = [];
  let inputIndex = 0;
  const inputs = options.inputs ?? [];
  return {
    ui: {
      notify: (message: string, type: string) => {
        notifications.push({ message, type });
      },
      input: async (_prompt: string) => {
        const value = inputs[inputIndex] ?? "";
        inputIndex++;
        return value;
      },
    },
    hasUI: options.hasUI ?? true,
    get notifications() { return notifications; },
  } as unknown as ExtensionCommandContext & { notifications: Array<{ message: string; type: string }> };
}

function fakeRuntime(options: { credentialsConfigured?: boolean; personId?: number; credentialSource?: "env" | "config" } = {}) {
  const calls = {
    status: 0,
    trySyncNow: 0,
    syncProjectsCatalog: 0,
    queryTime: 0,
    editTime: 0,
    setProjectDefaults: 0,
    reloadCredentials: 0,
    editTimer: 0,
    deleteTimer: 0,
  };

  const lastEditPatch: Record<string, unknown>[] = [];
  const lastTimerEditPatch: Record<string, unknown>[] = [];

  const credentialsConfigured = options.credentialsConfigured ?? true;
  const personId = options.personId ?? 42;
  const credentialSource = options.credentialSource ?? (credentialsConfigured ? "env" : undefined);

  const runtime = {
    status: () => {
      calls.status++;
      return { home: "/tmp/intervals", credentialsConfigured, credentialSource, dbOpen: true, personId, apiClient: credentialsConfigured };
    },
    trySyncNow: async () => {
      calls.trySyncNow++;
      return { timeEntriesCreated: 1, timeEntriesUpdated: 0, failed: 0 };
    },
    syncProjectsCatalog: async () => {
      calls.syncProjectsCatalog++;
      return { clients: 2, projects: 5, worktypes: 8, modules: 3 };
    },
    reloadCredentials: () => { calls.reloadCredentials++; },
    catalogStore: {
      searchProjectContext: () => [],
      getLastProjectSync: () => "2026-04-24T10:00:00.000Z",
    },
    timerStore: {
      listActive: () => [{ localId: "t1", description: "test timer", elapsedSeconds: 120, state: "active" }],
      listRecent: () => [{ localId: "t1", description: "test timer", elapsedSeconds: 120, state: "stopped" }],
    },
    timeEntryStore: {
      pendingForSync: () => [{ localId: "te1" }],
      listRecent: () => [{ localId: "te1", durationSeconds: 3600 }],
      getTimeEntry: () => ({ localId: "te1", durationSeconds: 3600, syncStatus: "pending" }),
      updateTimeEntry: () => ({ localId: "te1", durationSeconds: 3600, syncStatus: "pending" }),
    },
    timeService: {
      queryTime: () => {
        calls.queryTime++;
        return { startDate: "2026-04-24", endDate: "2026-04-24", totalSeconds: 3600, entries: [], byProject: [] };
      },
      editTime: (patch: Record<string, unknown>) => {
        calls.editTime++;
        lastEditPatch.push(patch);
        return { localId: "te1", syncStatus: "pending" };
      },
    },
    defaultsStore: {
      setProjectDefaults: () => { calls.setProjectDefaults++; },
    },
    timerService: {
      startTimer: () => ({ localId: "t1", description: "test" }),
      stopTimer: () => ({ localId: "te1", durationSeconds: 1800 }),
      editTimer: (patch: Record<string, unknown>) => {
        calls.editTimer++;
        lastTimerEditPatch.push(patch);
        return { localId: "t1", description: "test timer", elapsedSeconds: 120, state: "active" };
      },
      deleteTimer: () => {
        calls.deleteTimer++;
        return { localId: "t1", description: "test timer", elapsedSeconds: 120, state: "active" };
      },
    },
  } as unknown as ReturnType<typeof import("../src/runtime.js").createRuntime>;

  return { runtime, calls, lastEditPatch, lastTimerEditPatch };
}

function assertProjectSyncCompleteNotification(ctx: { notifications: Array<{ message: string; type: string }> }) {
  const syncNotify = ctx.notifications.find((n) => n.message.startsWith("Project sync complete"));
  assert.deepEqual(syncNotify, {
    message: "Project sync complete: 5 projects, 8 worktypes, 3 modules, 2 clients",
    type: "info",
  });
}

test("registers all required intervals commands", () => {
  const { pi, commands } = fakePi();
  const { runtime } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const names = commands.map((c) => c.name).sort();
  assert.deepEqual(names, [
    "intervals-project-defaults",
    "intervals-setup",
    "intervals-status",
    "intervals-sync-now",
    "intervals-sync-projects",
    "intervals-time",
    "intervals-timers",
  ]);
});

test("intervals-status shows db path and active timers", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-status")!;
  const ctx = fakeCtx();
  await cmd.handler("", ctx);
  assert.equal(calls.status, 1);
  const notify = ctx.notifications[0];
  assert.ok(notify.message.includes("/tmp/intervals"), "should mention db path");
  assert.ok(notify.message.includes("active timers: 1"), "should show active timer count");
});

test("intervals-sync-projects requires credentials", async () => {
  const { pi, commands } = fakePi();
  const runtime = {
    ...fakeRuntime().runtime,
    status: () => ({ home: "/tmp/intervals", credentialsConfigured: false, dbOpen: true }),
  } as unknown as ReturnType<typeof import("../src/runtime.js").createRuntime>;
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-sync-projects")!;
  const ctx = fakeCtx();
  await cmd.handler("", ctx);
  const errorNotify = ctx.notifications.find((n) => n.type === "error");
  assert.ok(errorNotify, "should show error when credentials missing");
  assert.ok(errorNotify!.message.includes("credentials"), "error should mention credentials");
});

test("intervals-sync-projects runs catalog sync when credentials exist", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-sync-projects")!;
  const ctx = fakeCtx();
  await cmd.handler("", ctx);
  assert.equal(calls.syncProjectsCatalog, 1);
  const successNotify = ctx.notifications.find((n) => n.type === "info");
  assert.ok(successNotify, "should show success notification");
});

test("intervals-sync-now runs sync service", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-sync-now")!;
  const ctx = fakeCtx();
  await cmd.handler("", ctx);
  assert.equal(calls.trySyncNow, 1);
  const notify = ctx.notifications[0];
  assert.ok(notify.message.includes("created=1"), "should report created count");
});

test("intervals-timers shows bright compact active timer rows", async () => {
  const { pi, commands } = fakePi();
  const { runtime } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-timers")!;
  const ctx = fakeCtx();
  await cmd.handler("", ctx);
  const notify = ctx.notifications[0];
  assert.ok(notify.message.includes("\u001b[92m● active\u001b[0m"), "should brighten active status");
  assert.ok(notify.message.includes("\u001b[93m2m\u001b[0m"), "should brighten elapsed time");
  assert.ok(notify.message.includes("\u001b[96mt1\u001b[0m"), "should brighten timer id");
  assert.ok(notify.message.includes("test timer"), "should show timer description");
});

test("intervals-timers edit updates a running timer", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-timers")!;
  const ctx = fakeCtx();
  await cmd.handler("edit t1 project_id=10 worktype_id=5 module_id=7", ctx);
  assert.equal(calls.editTimer, 1);
  const notify = ctx.notifications[0];
  assert.ok(notify.message.includes("Timer updated"), "should report timer update");
  assert.ok(notify.message.includes("test timer"), "should show updated timer");
});

test("intervals-timers edit updates a running timer description", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls, lastTimerEditPatch } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-timers")!;
  const ctx = fakeCtx();
  await cmd.handler('edit t1 description="Updated timer description"', ctx);
  assert.equal(calls.editTimer, 1);
  assert.equal(lastTimerEditPatch[0].description, "Updated timer description");
});

test("intervals-timers delete removes a timer", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-timers")!;
  const ctx = fakeCtx();
  await cmd.handler("delete t1", ctx);
  assert.equal(calls.deleteTimer, 1);
  const notify = ctx.notifications[0];
  assert.ok(notify.message.includes("Timer deleted"), "should report timer deletion");
  assert.ok(notify.message.includes("test timer"), "should show deleted timer");
});

test("intervals-time defaults to today", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-time")!;
  const ctx = fakeCtx();
  await cmd.handler("", ctx);
  assert.equal(calls.queryTime, 1);
  const notify = ctx.notifications[0];
  assert.ok(notify.message.includes("today"), "should mention today");
});

test("intervals-time edit triggers edit and sync", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-time")!;
  const ctx = fakeCtx();
  await cmd.handler("edit te1 duration_minutes=30", ctx);
  assert.equal(calls.editTime, 1);
  assert.equal(calls.trySyncNow, 1);
});

test("intervals-project-defaults sets defaults", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-project-defaults")!;
  const ctx = fakeCtx();
  await cmd.handler("10 5 7", ctx);
  assert.equal(calls.setProjectDefaults, 1);
  const notify = ctx.notifications.find((n) => n.type === "info");
  assert.ok(notify, "should show success");
});

test("intervals-setup with env credentials syncs project catalog immediately", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime({ credentialSource: "env" });
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-setup")!;
  const ctx = fakeCtx();

  await cmd.handler("", ctx);

  assert.equal(calls.syncProjectsCatalog, 1, "should sync project catalog immediately");
  const sourceNotify = ctx.notifications.find((n) => n.message.includes("environment"));
  assert.ok(sourceNotify, "should mention env source when credentials are configured");
  assertProjectSyncCompleteNotification(ctx);
});

test("intervals-setup with config credentials syncs project catalog immediately", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime({ credentialSource: "config" });
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-setup")!;
  const ctx = fakeCtx();

  await cmd.handler("", ctx);

  assert.equal(calls.syncProjectsCatalog, 1, "should sync project catalog immediately");
  const sourceNotify = ctx.notifications.find((n) => n.message.includes("config file"));
  assert.ok(sourceNotify, "should mention config source when credentials are configured");
  assertProjectSyncCompleteNotification(ctx);
});

test("intervals-sync-now reports error when credentials are missing", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime({ credentialsConfigured: false, personId: undefined });
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-sync-now")!;
  const ctx = fakeCtx();
  await cmd.handler("", ctx);
  assert.equal(calls.trySyncNow, 0, "should not call trySyncNow when not configured");
  const errorNotify = ctx.notifications.find((n) => n.type === "error");
  assert.ok(errorNotify, "should show error when credentials missing");
  assert.ok(errorNotify!.message.includes("credentials") || errorNotify!.message.includes("person ID"), "error should mention credentials or person ID");
});

test("intervals-time edit parses and validates patch fields", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls, lastEditPatch } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-time")!;
  const ctx = fakeCtx();
  await cmd.handler("edit te1 duration_minutes=30 project_id=5 worktype_id=2 module_id=8 billable=true description=hello date=2026-04-28 start_at=09:00 end_at=17:00", ctx);
  assert.equal(calls.editTime, 1);
  assert.equal(calls.trySyncNow, 1);
  const patch = lastEditPatch[0];
  assert.ok(patch, "patch should be captured");
  assert.equal(patch.localId, "te1");
  assert.equal(patch.durationSeconds, 1800);
  assert.equal(patch.projectId, 5);
  assert.equal(patch.worktypeId, 2);
  assert.equal(patch.moduleId, 8);
  assert.equal(patch.billable, true);
  assert.equal(patch.description, "hello");
  assert.equal(patch.date, "2026-04-28");
  assert.equal(patch.startAt, "09:00");
  assert.equal(patch.endAt, "17:00");
});

test("intervals-time edit rejects invalid numeric values", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-time")!;
  const ctx = fakeCtx();
  await cmd.handler("edit te1 duration_minutes=abc", ctx);
  assert.equal(calls.editTime, 0);
  const errorNotify = ctx.notifications.find((n) => n.type === "error");
  assert.ok(errorNotify, "should show error for invalid duration_minutes");
  assert.ok(errorNotify!.message.includes("duration_minutes"), "error should mention duration_minutes");
});

test("intervals-time edit rejects unknown fields", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-time")!;
  const ctx = fakeCtx();
  await cmd.handler("edit te1 unknown_field=xyz", ctx);
  assert.equal(calls.editTime, 0);
  const errorNotify = ctx.notifications.find((n) => n.type === "error");
  assert.ok(errorNotify, "should show error for unknown field");
  assert.ok(errorNotify!.message.includes("Unknown field"), "error should mention unknown field");
});

test("intervals-setup with no credentials and no UI reports error", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime({ credentialsConfigured: false, personId: undefined, credentialSource: undefined });
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-setup")!;
  const ctx = fakeCtx({ hasUI: false });
  await cmd.handler("", ctx);
  assert.equal(calls.reloadCredentials, 0);
  const errorNotify = ctx.notifications.find((n) => n.type === "error");
  assert.ok(errorNotify, "should show error when no credentials and no UI");
  assert.ok(errorNotify!.message.includes("credentials"), "error should mention credentials");
});

test("intervals-setup interactive save reloads credentials and syncs", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime({ credentialsConfigured: false, personId: undefined, credentialSource: undefined });
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-setup")!;
  const ctx = fakeCtx({ inputs: ["my-api-key", "42"] });
  await cmd.handler("", ctx);
  assert.equal(calls.reloadCredentials, 1, "should reload credentials after saving");
  assert.equal(calls.syncProjectsCatalog, 1, "should sync projects after setup");
  assertProjectSyncCompleteNotification(ctx);
});

test("intervals-project-defaults rejects invalid numeric ids", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-project-defaults")!;
  const ctx = fakeCtx();
  await cmd.handler("abc 5", ctx);
  assert.equal(calls.setProjectDefaults, 0);
  const errorNotify = ctx.notifications.find((n) => n.type === "error");
  assert.ok(errorNotify, "should show error for invalid project_id");
});
