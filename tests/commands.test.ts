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

function fakeRuntime() {
  const calls = {
    status: 0,
    trySyncNow: 0,
    syncProjectsCatalog: 0,
    queryTime: 0,
    editTime: 0,
    setProjectDefaults: 0,
  };

  const runtime = {
    status: () => {
      calls.status++;
      return { home: "/tmp/intervals", credentialsConfigured: true, credentialSource: "env" as const, dbOpen: true, personId: 42, apiClient: true };
    },
    trySyncNow: async () => {
      calls.trySyncNow++;
      return { timeEntriesCreated: 1, timeEntriesUpdated: 0, failed: 0 };
    },
    syncProjectsCatalog: async () => {
      calls.syncProjectsCatalog++;
      return { clients: 2, projects: 5, worktypes: 8, modules: 3 };
    },
    catalogStore: {
      searchProjectContext: () => [],
      getLastProjectSync: () => "2026-04-24T10:00:00.000Z",
    },
    timerStore: {
      listActive: () => [{ localId: "t1", description: "test timer" }],
      listRecent: () => [{ localId: "t1", description: "test timer" }],
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
      editTime: () => {
        calls.editTime++;
        return { localId: "te1", syncStatus: "pending" };
      },
    },
    defaultsStore: {
      setProjectDefaults: () => { calls.setProjectDefaults++; },
    },
    timerService: {
      startTimer: () => ({ localId: "t1", description: "test" }),
      stopTimer: () => ({ localId: "te1", durationSeconds: 1800 }),
    },
  } as unknown as ReturnType<typeof import("../src/runtime.js").createRuntime>;

  return { runtime, calls };
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

test("intervals-timers shows active timers", async () => {
  const { pi, commands } = fakePi();
  const { runtime } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-timers")!;
  const ctx = fakeCtx();
  await cmd.handler("", ctx);
  const notify = ctx.notifications[0];
  assert.ok(notify.message.includes("test timer"), "should show timer description");
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

test("intervals-setup with env credentials shows env source", async () => {
  const { pi, commands } = fakePi();
  const { runtime } = fakeRuntime();
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-setup")!;
  const ctx = fakeCtx();
  await cmd.handler("", ctx);
  const notify = ctx.notifications.find((n) => n.message.includes("env"));
  assert.ok(notify, "should mention env source when credentials are configured");
});
