import assert from "node:assert/strict";
import test from "node:test";
import { registerIntervalsTools } from "../src/tools.js";
import type { ExtensionAPI, ToolDefinition } from "@mariozechner/pi-coding-agent";

function fakePi(): { pi: ExtensionAPI; tools: ToolDefinition[] } {
  const tools: ToolDefinition[] = [];
  const pi = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

function fakeRuntime() {
  const calls = {
    startTimer: [] as unknown[],
    stopTimer: [] as unknown[],
    addTime: [] as unknown[],
    editTime: [] as unknown[],
    editTimer: [] as unknown[],
    deleteTimer: [] as unknown[],
    trySyncNow: 0,
  };
  const runtime = {
    status: () => ({ credentialsConfigured: false }),
    catalogStore: {
      searchProjectContext: () => [],
      getProject: () => undefined,
      getWorktype: () => undefined,
      getModule: () => undefined,
    },
    defaultsStore: {
      setProjectDefaults: () => {},
    },
    timerService: {
      startTimer: (...args: unknown[]) => {
        calls.startTimer.push(args);
        return { localId: "t1", description: "test", startedAt: "2026-04-24T10:00:00Z", elapsedSeconds: 0, state: "active", createdAt: "2026-04-24T10:00:00Z", updatedAt: "2026-04-24T10:00:00Z" };
      },
      stopTimer: (...args: unknown[]) => {
        calls.stopTimer.push(args);
        return { localId: "te1", projectId: 10, worktypeId: 5, date: "2026-04-24", durationSeconds: 1800, billable: true, syncStatus: "pending", syncAttempts: 0, createdAt: "2026-04-24T10:00:00Z", updatedAt: "2026-04-24T10:00:00Z" };
      },
      editTimer: (...args: unknown[]) => {
        calls.editTimer.push(args);
        return { localId: "t1", description: "test", projectId: 10, worktypeId: 5, moduleId: 7, startedAt: "2026-04-24T10:00:00Z", elapsedSeconds: 0, state: "active", createdAt: "2026-04-24T10:00:00Z", updatedAt: "2026-04-24T10:05:00Z" };
      },
      deleteTimer: (...args: unknown[]) => {
        calls.deleteTimer.push(args);
        return { localId: "t1", description: "test", startedAt: "2026-04-24T10:00:00Z", elapsedSeconds: 0, state: "active", createdAt: "2026-04-24T10:00:00Z", updatedAt: "2026-04-24T10:00:00Z" };
      },
      listActive: () => [],
    },
    timeService: {
      addTime: (...args: unknown[]) => {
        calls.addTime.push(args);
        return { localId: "te1", projectId: 10, worktypeId: 5, date: "2026-04-24", durationSeconds: 3600, billable: true, syncStatus: "pending", syncAttempts: 0, createdAt: "2026-04-24T10:00:00Z", updatedAt: "2026-04-24T10:00:00Z" };
      },
      editTime: (...args: unknown[]) => {
        calls.editTime.push(args);
        return { localId: "te1", projectId: 10, worktypeId: 5, date: "2026-04-24", durationSeconds: 1800, billable: true, syncStatus: "pending", syncAttempts: 0, createdAt: "2026-04-24T10:00:00Z", updatedAt: "2026-04-24T10:00:00Z" };
      },
      queryTime: () => ({
        startDate: "2026-04-24",
        endDate: "2026-04-24",
        totalSeconds: 0,
        entries: [],
        byProject: [],
      }),
    },
    timerStore: {
      listRecent: () => [],
    },
    timeEntryStore: {
      listRecent: () => [],
      getTimeEntry: () => ({ localId: "te1", date: "2026-04-24", startAt: "07:07" }),
      findBySourceTimerId: () => undefined,
    },
    trySyncNow: async () => {
      calls.trySyncNow += 1;
      return { timeEntriesCreated: 0, timeEntriesUpdated: 0, failed: 0 };
    },
  } as unknown as ReturnType<typeof import("../src/runtime.js").createRuntime>;
  return { runtime, calls };
}

test("registers all required intervals tools", () => {
  const { pi, tools } = fakePi();
  const { runtime } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "intervals_add_time",
    "intervals_delete_timer",
    "intervals_edit_time",
    "intervals_edit_timer",
    "intervals_find_project_context",
    "intervals_list_time",
    "intervals_list_timers",
    "intervals_lookup_time_entry",
    "intervals_query_time",
    "intervals_set_project_defaults",
    "intervals_start_timer",
    "intervals_stop_timer",
    "intervals_sync_now",
  ]);
});

test("each tool has a promptSnippet and promptGuidelines", () => {
  const { pi, tools } = fakePi();
  const { runtime } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  for (const tool of tools) {
    assert.ok(tool.promptSnippet, `${tool.name} should have promptSnippet`);
    assert.ok(Array.isArray(tool.promptGuidelines), `${tool.name} should have promptGuidelines array`);
    assert.ok(tool.promptGuidelines.length > 0, `${tool.name} should have at least one guideline`);
  }
});

test("intervals_find_project_context returns global Intervals worktype and module IDs", async () => {
  const { pi, tools } = fakePi();
  const { runtime } = fakeRuntime();
  (runtime.catalogStore as unknown as { searchProjectContext: (input: unknown) => unknown }).searchProjectContext = () => [
    {
      projectId: 1447065,
      projectName: "Clubhouse Consulting",
      clientName: "Alpha Exploration Co.",
      billable: true,
      worktypes: [
        { id: 32088213, worktypeId: 816862, name: "Consulting", active: true },
      ],
      modules: [
        { id: 22457817, moduleId: 560580, name: "foundations", active: true },
      ],
    },
  ];
  registerIntervalsTools(runtime, pi);

  const tool = tools.find((t) => t.name === "intervals_find_project_context")!;
  const result = await tool.execute("call-1", { query: "Clubhouse" }, undefined, undefined, {} as any);
  const text = String((result.content[0] as { type: "text"; text: string }).text);

  assert.ok(text.includes("816862 Consulting"), `expected global worktype id in output, got: ${text}`);
  assert.ok(text.includes("560580 foundations"), `expected global module id in output, got: ${text}`);
  assert.ok(!text.includes("32088213"), "should not expose local project_worktypes.id");
  assert.ok(!text.includes("22457817"), "should not expose local project_modules.id");
});

test("intervals_start_timer requires only description", async () => {
  const { pi, tools } = fakePi();
  const { runtime } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_start_timer")!;
  const result = await tool.execute("call-1", { description: "write tests" }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("t1"));
});

test("intervals_stop_timer creates time entry and triggers sync", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_stop_timer")!;
  const result = await tool.execute("call-1", { timer_id: "t1", project_id: 10, worktype_id: 5 }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("te1"));
  assert.equal(calls.trySyncNow, 1, "trySyncNow should be called once");
});

test("intervals_edit_timer updates running timer classification", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_edit_timer")!;
  const result = await tool.execute("call-1", { timer_id: "t1", project_id: 10, worktype_id: 5, module_id: 7 }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("t1"));

  const editCall = calls.editTimer[0] as [{ localId?: string; projectId?: number; worktypeId?: number; moduleId?: number }];
  assert.deepEqual(editCall[0], { localId: "t1", projectId: 10, worktypeId: 5, moduleId: 7 });
});

test("intervals_edit_timer updates a running timer description", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_edit_timer")!;
  const result = await tool.execute("call-1", { timer_id: "t1", description: "Updated timer description" }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("t1"));

  const editCall = calls.editTimer[0] as [{ localId?: string; description?: string }];
  assert.deepEqual(editCall[0], { localId: "t1", description: "Updated timer description" });
});

test("intervals_delete_timer deletes a timer", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_delete_timer")!;
  const result = await tool.execute("call-1", { timer_id: "t1" }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("Timer deleted"));

  const deleteCall = calls.deleteTimer[0] as [{ localId?: string }];
  assert.deepEqual(deleteCall[0], { localId: "t1" });
});

test("intervals_lookup_time_entry returns the time entry id for a source timer", async () => {
  const { pi, tools } = fakePi();
  const { runtime } = fakeRuntime();
  (runtime.timeEntryStore as any).findBySourceTimerId = () => ({ localId: "4ee96f17" });
  registerIntervalsTools(runtime, pi);

  const tool = tools.find((t) => t.name === "intervals_lookup_time_entry")!;
  const result = await tool.execute("call-1", { timer_id: "19ee097c" }, undefined, undefined, {} as any);
  const text = String((result.content[0] as { type: "text"; text: string }).text);

  assert.equal(text.trim(), "time_entry_id: 4ee96f17");
  assert.deepEqual((result as any).details, { timeEntryId: "4ee96f17", timerId: "19ee097c" });
});

test("intervals_lookup_time_entry returns full legacy UUID local ids", async () => {
  const { pi, tools } = fakePi();
  const { runtime } = fakeRuntime();
  const localId = "4ee96f17-0374-4d1b-a92a-05956213a007";
  (runtime.timeEntryStore as any).findBySourceTimerId = () => ({ localId });
  registerIntervalsTools(runtime, pi);

  const tool = tools.find((t) => t.name === "intervals_lookup_time_entry")!;
  const result = await tool.execute("call-1", { timer_id: "19ee097c" }, undefined, undefined, {} as any);
  const text = String((result.content[0] as { type: "text"; text: string }).text);

  assert.equal(text.trim(), `time_entry_id: ${localId}`);
  assert.deepEqual((result as any).details, { timeEntryId: localId, timerId: "19ee097c" });
});

test("intervals_edit_time passes stop_time to service", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_edit_time")!;

  await tool.execute("call-1", { time_entry_id: "4ee96f17", stop_time: "08:35" }, undefined, undefined, {} as any);

  const editCall = calls.editTime[0] as [{ stopTime?: string }];
  assert.equal(editCall[0].stopTime, "08:35");
});

test("intervals_edit_time with stop_time returns timing summary lines", async () => {
  const { pi, tools } = fakePi();
  const { runtime } = fakeRuntime();
  (runtime.timeEntryStore as any).getTimeEntry = () => ({
    localId: "4ee96f17",
    date: "2026-05-05",
    startAt: "07:07",
  });
  (runtime.timeService as any).editTime = () => ({
    localId: "4ee96f17",
    projectId: 10,
    worktypeId: 5,
    date: "2026-05-05",
    startAt: "07:07",
    endAt: "08:35",
    durationSeconds: 5400,
    billable: true,
    syncStatus: "pending",
    syncAttempts: 0,
    createdAt: "2026-05-05T07:07:00.000Z",
    updatedAt: "2026-05-05T08:35:00.000Z",
  });
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_edit_time")!;

  const result = await tool.execute("call-1", { time_entry_id: "4ee96f17", stop_time: "08:35" }, undefined, undefined, {} as any);
  const text = String((result.content[0] as { type: "text"; text: string }).text);

  assert.match(text, /start:/);
  assert.match(text, /end:/);
  assert.match(text, /raw duration:/);
  assert.match(text, /rounded duration:/);
});

test("intervals_edit_time rejects both time_entry_id and timer_id", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  (runtime.timeEntryStore as any).findBySourceTimerId = () => ({ localId: "from-timer" });
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_edit_time")!;

  await assert.rejects(
    () => tool.execute("call-1", { time_entry_id: "te1", timer_id: "t1" }, undefined, undefined, {} as any),
    /cannot specify both time_entry_id and timer_id/,
  );
  assert.equal(calls.editTime.length, 0);
});

test("intervals_edit_time rejects timer_id when no linked entry exists", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_edit_time")!;

  await assert.rejects(
    () => tool.execute("call-1", { timer_id: "t1" }, undefined, undefined, {} as any),
    /no time entry linked to timer: t1/,
  );
  assert.equal(calls.editTime.length, 0);
});

test("intervals_edit_time converts duration_minutes to seconds and triggers sync", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_edit_time")!;
  const result = await tool.execute("call-1", { time_entry_id: "te1", duration_minutes: 30 }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("te1"));
  assert.equal(calls.trySyncNow, 1, "trySyncNow should be called once");

  const editCall = calls.editTime[0] as [{ durationSeconds?: number }];
  assert.equal(editCall[0].durationSeconds, 1800, "duration_minutes should be converted to seconds");
});

test("intervals_add_time converts duration_minutes to seconds", async () => {
  const { pi, tools } = fakePi();
  const { runtime, calls } = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_add_time")!;
  const result = await tool.execute("call-1", { project_id: 10, date: "2026-04-24", duration_minutes: 60 }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("te1"));

  const addCall = calls.addTime[0] as [{ durationSeconds?: number }];
  assert.equal(addCall[0].durationSeconds, 3600, "duration_minutes should be converted to seconds");
});
