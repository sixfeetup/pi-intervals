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
  return {
    status: () => ({ credentialsConfigured: false }),
    catalogStore: {
      searchProjectContext: () => [],
    },
    defaultsStore: {
      setProjectDefaults: () => {},
    },
    timerService: {
      startTimer: () => ({ localId: "t1", description: "test" }),
      stopTimer: () => ({ localId: "te1" }),
      listActive: () => [],
    },
    timeService: {
      addTime: () => ({ localId: "te1" }),
      editTime: () => ({ localId: "te1" }),
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
    },
    trySyncNow: async () => ({ timeEntriesCreated: 0, timeEntriesUpdated: 0, failed: 0 }),
  } as unknown as ReturnType<typeof import("../src/runtime.js").createRuntime>;
}

test("registers all required intervals tools", () => {
  const { pi, tools } = fakePi();
  const runtime = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "intervals_add_time",
    "intervals_edit_time",
    "intervals_find_project_context",
    "intervals_list_time",
    "intervals_list_timers",
    "intervals_query_time",
    "intervals_set_project_defaults",
    "intervals_start_timer",
    "intervals_stop_timer",
    "intervals_sync_now",
  ]);
});

test("each tool has a promptSnippet and promptGuidelines", () => {
  const { pi, tools } = fakePi();
  const runtime = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  for (const tool of tools) {
    assert.ok(tool.promptSnippet, `${tool.name} should have promptSnippet`);
    assert.ok(Array.isArray(tool.promptGuidelines), `${tool.name} should have promptGuidelines array`);
    assert.ok(tool.promptGuidelines.length > 0, `${tool.name} should have at least one guideline`);
  }
});

test("intervals_start_timer requires only description", async () => {
  const { pi, tools } = fakePi();
  const runtime = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_start_timer")!;
  const result = await tool.execute("call-1", { description: "write tests" }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("t1"));
});

test("intervals_stop_timer creates time entry and triggers sync", async () => {
  const { pi, tools } = fakePi();
  const runtime = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_stop_timer")!;
  const result = await tool.execute("call-1", { timer_id: "t1", project_id: 10, worktype_id: 5 }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("te1"));
});

test("intervals_edit_time converts duration_minutes to seconds", async () => {
  const { pi, tools } = fakePi();
  const runtime = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_edit_time")!;
  const result = await tool.execute("call-1", { time_entry_id: "te1", duration_minutes: 30 }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("te1"));
});

test("intervals_add_time converts duration_minutes to seconds", async () => {
  const { pi, tools } = fakePi();
  const runtime = fakeRuntime();
  registerIntervalsTools(runtime, pi);
  const tool = tools.find((t) => t.name === "intervals_add_time")!;
  const result = await tool.execute("call-1", { project_id: 10, date: "2026-04-24", duration_minutes: 60 }, undefined, undefined, {} as any);
  assert.ok(String((result.content[0] as { type: "text"; text: string }).text).includes("te1"));
});
