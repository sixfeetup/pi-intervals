import { StringEnum } from "@mariozechner/pi-ai";
import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { formatDuration, formatSyncSummary, formatTimeEntry, formatTimeReport, formatTimer } from "./format.js";
import type { Runtime } from "./runtime.js";

function resolveProjectQuery(
	runtime: Runtime,
	projectQuery: string | undefined,
): number | undefined {
	if (!projectQuery) return undefined;
	const matches = runtime.catalogStore.searchProjectContext({ query: projectQuery, limit: 5 });
	if (matches.length === 0) {
		throw new Error(`no project found for query: ${projectQuery}`);
	}
	if (matches.length > 1) {
		throw new Error(`project query is ambiguous: ${projectQuery} (${matches.length} matches)`);
	}
	return matches[0].projectId;
}

function textResult(text: string, details?: unknown) {
	return {
		content: [{ type: "text" as const, text }],
		details: details ?? {},
	};
}

export function registerIntervalsTools(runtime: Runtime, pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: "intervals_find_project_context",
			label: "Find Intervals project context",
			description:
				"Search local Intervals project catalog for projects, worktypes, and modules. Returns matching projects with their classifications. This is local-only and does not call the Intervals API.",
			promptSnippet: "intervals_find_project_context — search local project catalog by name or client",
			promptGuidelines: [
				"Use intervals_find_project_context to discover project IDs, worktype IDs, and module IDs before starting timers or adding time entries.",
				"intervals_find_project_context is local-only and does not sync with Intervals.",
			],
			parameters: Type.Object({
				query: Type.Optional(Type.String({ description: "Free-text search across project and client names" })),
				project_id: Type.Optional(Type.Number({ description: "Exact project ID to look up" })),
				limit: Type.Optional(Type.Number({ description: "Maximum results to return", default: 20 })),
			}),
			execute: async (_toolCallId, params) => {
				const results = runtime.catalogStore.searchProjectContext({
					query: params.query,
					projectId: params.project_id,
					limit: params.limit ?? 20,
				});
				const lines = results.map((r) => {
					const wts = r.worktypes
						.map((w) => `${w.worktypeId ?? w.id} ${w.name}`)
						.join(", ") || "none";
					const mods = r.modules
						.map((m) => `${m.moduleId ?? m.id} ${m.name}`)
						.join(", ") || "none";
					return `${r.projectId}: ${r.projectName} (${r.clientName ?? "no client"}) — worktypes: ${wts}; modules: ${mods}`;
				});
				return textResult(lines.join("\n") || "No projects found.", { results });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_start_timer",
			label: "Start Intervals timer",
			description:
				"Start a local timer to capture work in progress. Only a description is required. Optional project, worktype, and module hints can be provided but are not required. Timers are local-only and are not synced to Intervals until stopped.",
			promptSnippet: "intervals_start_timer — begin a local timer with just a description",
			promptGuidelines: [
				"Use intervals_start_timer when the user begins a new task. Only description is required.",
				"Do not block timer start if project/worktype/module are unknown; capture them when stopping the timer.",
				"intervals_start_timer is local-only and does not create an Intervals timer resource.",
			],
			parameters: Type.Object({
				description: Type.String({ description: "Short description of the work being performed" }),
				project_id: Type.Optional(Type.Number({ description: "Optional project ID hint" })),
				project_query: Type.Optional(Type.String({ description: "Optional project search query to resolve a project ID" })),
				worktype_id: Type.Optional(Type.Number({ description: "Optional worktype ID hint" })),
				module_id: Type.Optional(Type.Number({ description: "Optional module ID hint" })),
				notes: Type.Optional(Type.String({ description: "Optional notes for the timer" })),
			}),
			execute: async (_toolCallId, params) => {
				const projectId = resolveProjectQuery(runtime, params.project_query) ?? params.project_id;
				const timer = runtime.timerService.startTimer({
					description: params.description,
					projectId,
					worktypeId: params.worktype_id,
					moduleId: params.module_id,
					notes: params.notes,
				});
				return textResult(formatTimer(timer), { timer });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_stop_timer",
			label: "Stop Intervals timer",
			description:
				"Stop a local timer and convert it into a pending time entry. You must provide or resolve the project and worktype. The resulting time entry is then synced to Intervals.",
			promptSnippet: "intervals_stop_timer — stop a timer, classify it, and sync the time entry",
			promptGuidelines: [
				"Use intervals_stop_timer when the user finishes a task. Provide the timer_id and classification fields (project, worktype, module) if not already known.",
				"If project or worktype are missing, resolve them via intervals_find_project_context first, or use project_query to resolve them during the stop call.",
				"intervals_stop_timer creates a local time entry and triggers time-entry sync immediately.",
			],
			parameters: Type.Object({
				timer_id: Type.String({ description: "Local ID of the active timer to stop" }),
				project_id: Type.Optional(Type.Number({ description: "Project ID for the time entry" })),
				project_query: Type.Optional(Type.String({ description: "Project search query to resolve the project" })),
				worktype_id: Type.Optional(Type.Number({ description: "Worktype ID for the time entry" })),
				module_id: Type.Optional(Type.Number({ description: "Module ID for the time entry" })),
				description: Type.Optional(Type.String({ description: "Override description for the time entry" })),
				billable: Type.Optional(Type.Boolean({ description: "Whether the time entry is billable", default: true })),
			}),
			execute: async (_toolCallId, params) => {
				const projectId = resolveProjectQuery(runtime, params.project_query) ?? params.project_id;
				const entry = runtime.timerService.stopTimer({
					localId: params.timer_id,
					projectId,
					worktypeId: params.worktype_id,
					moduleId: params.module_id,
					description: params.description,
					billable: params.billable,
				});
				const syncResult = await runtime.trySyncNow();
				const projectName = runtime.catalogStore.getProject(entry.projectId)?.name ?? `Project ${entry.projectId}`;
				const worktypeName = runtime.catalogStore.getWorktype(entry.projectId, entry.worktypeId)?.name ?? `Worktype ${entry.worktypeId}`;
				const dur = formatDuration(entry.durationSeconds);
				return textResult(
					`Timer stopped → ${entry.localId}\n${entry.date} ${dur} ${projectName} (${worktypeName})${entry.description ? ` | ${entry.description}` : ""}\n${formatSyncSummary(syncResult)}`,
					{ entry, sync: syncResult },
				);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_edit_timer",
			label: "Edit Intervals timer",
			description:
				"Update a running local timer's project, worktype, or module hints. This is local-only and affects the time entry created when the timer is stopped.",
			promptSnippet: "intervals_edit_timer — update project/worktype/module on a running timer",
			promptGuidelines: [
				"Use intervals_edit_timer when the user wants to update a running timer description or classification without stopping it.",
				"Resolve project/worktype/module IDs with intervals_find_project_context before editing when needed.",
				"intervals_edit_timer is local-only; it does not sync anything to Intervals until the timer is stopped.",
			],
			parameters: Type.Object({
				timer_id: Type.String({ description: "Local ID of the active timer to edit" }),
				project_id: Type.Optional(Type.Number({ description: "Project ID hint for the timer" })),
				project_query: Type.Optional(Type.String({ description: "Project search query to resolve the project" })),
				worktype_id: Type.Optional(Type.Number({ description: "Worktype ID hint for the timer" })),
				module_id: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: "Module ID hint, or null to clear" })),
				description: Type.Optional(Type.String({ description: "New timer description" })),
			}),
			execute: async (_toolCallId, params) => {
				const projectId = resolveProjectQuery(runtime, params.project_query) ?? params.project_id;
				const patch: Parameters<typeof runtime.timerService.editTimer>[0] = { localId: params.timer_id };
				if (projectId !== undefined) patch.projectId = projectId;
				if (params.worktype_id !== undefined) patch.worktypeId = params.worktype_id;
				if (params.module_id !== undefined) patch.moduleId = params.module_id;
				if (params.description !== undefined) patch.description = params.description;
				const timer = runtime.timerService.editTimer(patch);
				return textResult(`Timer updated → ${formatTimer(timer)}`, { timer });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_delete_timer",
			label: "Delete Intervals timer",
			description:
				"Delete a local timer safely. Active timers can be discarded. Stopped timers can only be deleted when they do not have a linked time entry.",
			promptSnippet: "intervals_delete_timer — safely delete a local timer",
			promptGuidelines: [
				"Use intervals_delete_timer to discard an active timer that should not become a time entry.",
				"Stopped timers are only deleted when no time entry links back to the timer.",
				"If deletion fails because a linked time entry exists, edit or delete the time entry instead.",
			],
			parameters: Type.Object({
				timer_id: Type.String({ description: "Local ID of the timer to delete" }),
			}),
			execute: async (_toolCallId, params) => {
				const timer = runtime.timerService.deleteTimer({ localId: params.timer_id });
				return textResult(`Timer deleted → ${formatTimer(timer)}`, { timer });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_add_time",
			label: "Add Intervals time entry",
			description:
				"Add a time entry directly without using a timer. Duration is given in minutes and converted to seconds locally. The entry is created as pending and will sync on the next sync pass.",
			promptSnippet: "intervals_add_time — create a time entry from minutes and classification",
			promptGuidelines: [
				"Use intervals_add_time when the user wants to log time retroactively without starting a timer.",
				"Convert the user's duration to minutes before passing duration_minutes.",
				"intervals_add_time creates a pending local time entry; run intervals_sync_now to push it immediately.",
			],
			parameters: Type.Object({
				project_id: Type.Number({ description: "Project ID for the time entry" }),
				worktype_id: Type.Optional(Type.Number({ description: "Worktype ID (required if no project default is set)" })),
				module_id: Type.Optional(Type.Number({ description: "Module ID" })),
				date: Type.String({ description: "Date for the time entry (YYYY-MM-DD)" }),
				duration_minutes: Type.Number({ description: "Duration in minutes (will be converted to seconds)" }),
				description: Type.Optional(Type.String({ description: "Description of the work" })),
				billable: Type.Optional(Type.Boolean({ description: "Whether the time entry is billable", default: true })),
			}),
			execute: async (_toolCallId, params) => {
				const entry = runtime.timeService.addTime({
					projectId: params.project_id,
					worktypeId: params.worktype_id,
					moduleId: params.module_id,
					date: params.date,
					durationSeconds: Math.round(params.duration_minutes * 60),
					description: params.description,
					billable: params.billable,
				});
				return textResult(
					`${entry.localId}\n${formatTimeEntry({
						...entry,
						projectName: runtime.catalogStore.getProject(entry.projectId)?.name,
						worktypeName: runtime.catalogStore.getWorktype(entry.projectId, entry.worktypeId)?.name,
						moduleName: entry.moduleId != null
							? runtime.catalogStore.getModule(entry.projectId, entry.moduleId)?.name
							: undefined,
					})}`,
					{ entry },
				);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_edit_time",
			label: "Edit Intervals time entry",
			description:
				"Edit an existing local time entry. If duration_minutes is provided, it is converted to seconds. The entry is marked pending and time-entry sync is triggered. If the entry was previously synced, it will be updated via PUT on the next sync.",
			promptSnippet: "intervals_edit_time — modify a local time entry and re-sync",
			promptGuidelines: [
				"Use intervals_edit_time when the user wants to correct a time entry's duration, description, project, worktype, module, date, or local stop time.",
				"If the entry has a remote_id, it will be updated via PUT during the next sync. If it has no remote_id, it will be created via POST.",
				"intervals_edit_time converts duration_minutes to seconds and triggers time-entry sync immediately.",
			],
			parameters: Type.Object({
				time_entry_id: Type.Optional(Type.String({ description: "Local ID of the time entry to edit. Optional when timer_id is provided." })),
				project_id: Type.Optional(Type.Number({ description: "New project ID" })),
				project_query: Type.Optional(Type.String({ description: "Project search query to resolve a new project" })),
				worktype_id: Type.Optional(Type.Number({ description: "New worktype ID" })),
				module_id: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: "New module ID, or null to clear" })),
				date: Type.Optional(Type.String({ description: "New date (YYYY-MM-DD)" })),
				start_at: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "New start time, or null to clear" })),
				end_at: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "New end time, or null to clear" })),
				stop_time: Type.Optional(Type.String({ description: "Local stop time as HH:mm. Recalculates duration from start_at and updates end_at." })),
				timer_id: Type.Optional(Type.String({ description: "Source timer ID for the time entry to edit, mutually exclusive with time_entry_id" })),
				duration_minutes: Type.Optional(Type.Number({ description: "New duration in minutes (converted to seconds)" })),
				description: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "New description, or null to clear" })),
				billable: Type.Optional(Type.Boolean({ description: "Whether the entry is billable" })),
			}),
			execute: async (_toolCallId, params) => {
				if (params.time_entry_id && params.timer_id) {
					throw new Error("cannot specify both time_entry_id and timer_id");
				}
				if (!params.time_entry_id && !params.timer_id) {
					throw new Error("time_entry_id or timer_id is required");
				}

				const localId = params.time_entry_id
					?? (() => {
						const linked = runtime.timeEntryStore.findBySourceTimerId(params.timer_id!);
						if (!linked) throw new Error(`no time entry linked to timer: ${params.timer_id}`);
						return linked.localId;
					})();

				const entry = runtime.timeService.editTime({
					localId,
					projectId: params.project_id,
					projectQuery: params.project_query,
					worktypeId: params.worktype_id,
					moduleId: params.module_id,
					date: params.date,
					startAt: params.start_at,
					endAt: params.end_at,
					stopTime: params.stop_time,
					durationSeconds: params.duration_minutes != null ? Math.round(params.duration_minutes * 60) : undefined,
					description: params.description,
					billable: params.billable,
				});
				const syncResult = await runtime.trySyncNow();
				return textResult(
					`Time entry updated: ${entry.localId}\n${formatSyncSummary(syncResult)}`,
					{ entry, sync: syncResult },
				);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_query_time",
			label: "Query Intervals time entries",
			description:
				"Query local time entries by date range and optional project filter. This is local-only and does not call the Intervals API. Use it for reporting and summaries.",
			promptSnippet: "intervals_query_time — report time entries locally by range and project",
			promptGuidelines: [
				"Use intervals_query_time for all time reporting and summaries.",
				"intervals_query_time is local-only and does not sync with Intervals. It reads from the local SQLite database.",
				"If the user asks 'how much time did I log', use intervals_query_time with range=today or range=this_week.",
			],
			parameters: Type.Object({
				range: StringEnum(["today", "this_week", "last_week", "this_month", "last_month", "custom"], {
					description: "Predefined date range",
				}),
				start_date: Type.Optional(Type.String({ description: "Required when range=custom (YYYY-MM-DD)" })),
				end_date: Type.Optional(Type.String({ description: "Required when range=custom (YYYY-MM-DD)" })),
				project_id: Type.Optional(Type.Number({ description: "Filter by project ID" })),
				project_query: Type.Optional(Type.String({ description: "Filter by project query (resolved to a single project)" })),
			}),
			execute: async (_toolCallId, params) => {
				const report = runtime.timeService.queryTime({
					range: params.range as import("./types.js").TimeRange,
					start_date: params.start_date,
					end_date: params.end_date,
					projectId: params.project_id,
					projectQuery: params.project_query,
				});
				return textResult(formatTimeReport(report), { report });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_list_timers",
			label: "List Intervals timers",
			description: "List active or recent local timers. Useful for showing the user what timers are running or were recently stopped.",
			promptSnippet: "intervals_list_timers — show active or recent local timers",
			promptGuidelines: [
				"Use intervals_list_timers when the user asks about running timers or recent timer activity.",
				"intervals_list_timers is local-only.",
			],
			parameters: Type.Object({
				state: Type.Optional(
					StringEnum(["active", "recent"], { description: "Filter by timer state", default: "active" }),
				),
				limit: Type.Optional(Type.Number({ description: "Maximum results", default: 20 })),
			}),
			execute: async (_toolCallId, params) => {
				const timers =
					params.state === "recent"
						? runtime.timerStore.listRecent(params.limit ?? 20)
						: runtime.timerStore.listActive();
				const lines = timers.map((t) => formatTimer(t));
				return textResult(lines.join("\n") || "No timers found.", { timers });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_lookup_time_entry",
			label: "Lookup Intervals time entry",
			description: "Find the local time entry ID linked to a stopped local timer. Agent-facing lookup to avoid SQLite inspection.",
			promptSnippet: "intervals_lookup_time_entry — map a stopped timer ID to its linked time entry ID",
			promptGuidelines: [
				"Use intervals_lookup_time_entry when the user references a stopped timer but intervals_edit_time needs a time entry ID.",
				"Do not inspect the SQLite database to map timers to time entries.",
			],
			parameters: Type.Object({
				timer_id: Type.String({ description: "Local timer ID" }),
			}),
			execute: async (_toolCallId, params) => {
				const entry = runtime.timeEntryStore.findBySourceTimerId(params.timer_id);
				if (!entry) throw new Error(`no time entry linked to timer: ${params.timer_id}`);
				return textResult(`time_entry_id: ${entry.localId.slice(0, 8)}`, {
					timeEntryId: entry.localId.slice(0, 8),
					timerId: params.timer_id,
				});
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_list_time",
			label: "List recent Intervals time entries",
			description: "List recent local time entries, including their sync status. Useful for reviewing recently logged time.",
			promptSnippet: "intervals_list_time — list recent local time entries",
			promptGuidelines: [
				"Use intervals_list_time when the user wants to review recently created or edited time entries.",
				"intervals_list_time is local-only.",
			],
			parameters: Type.Object({
				limit: Type.Optional(Type.Number({ description: "Maximum results", default: 20 })),
			}),
			execute: async (_toolCallId, params) => {
				const entries = runtime.timeEntryStore.listRecent({ limit: params.limit ?? 20 });
				const lines = entries.map((e) => formatTimeEntry({
					...e,
					projectName: runtime.catalogStore.getProject(e.projectId)?.name,
					worktypeName: runtime.catalogStore.getWorktype(e.projectId, e.worktypeId)?.name,
					moduleName: e.moduleId != null
						? runtime.catalogStore.getModule(e.projectId, e.moduleId)?.name
						: undefined,
				}));
				return textResult(lines.join("\n") || "No time entries found.", { entries });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_set_project_defaults",
			label: "Set Intervals project defaults",
			description:
				"Set the default worktype and optional module for a project. These defaults are used when starting timers or adding time entries without explicit worktype/module IDs.",
			promptSnippet: "intervals_set_project_defaults — configure default worktype/module for a project",
			promptGuidelines: [
				"Use intervals_set_project_defaults after the user confirms their preferred worktype (and module) for a project.",
				"Defaults reduce the need to specify worktype/module on every timer start or time entry.",
			],
			parameters: Type.Object({
				project_id: Type.Number({ description: "Project ID" }),
				worktype_id: Type.Optional(Type.Number({ description: "Default worktype ID" })),
				module_id: Type.Optional(Type.Number({ description: "Default module ID" })),
			}),
			execute: async (_toolCallId, params) => {
				runtime.defaultsStore.setProjectDefaults({
					projectId: params.project_id,
					defaultWorktypeId: params.worktype_id,
					defaultModuleId: params.module_id,
				});
				return textResult(
					`Project defaults set for project ${params.project_id}: worktype=${params.worktype_id ?? "unset"} module=${params.module_id ?? "unset"}`,
					{ projectId: params.project_id, worktypeId: params.worktype_id, moduleId: params.module_id },
				);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "intervals_sync_now",
			label: "Sync Intervals time entries now",
			description:
				"Immediately attempt to sync pending local time entries to Intervals. Returns counts of created, updated, and failed entries.",
			promptSnippet: "intervals_sync_now — push pending local time entries to Intervals",
			promptGuidelines: [
				"Use intervals_sync_now after adding, editing, or stopping timers to push pending time entries to Intervals immediately.",
				"If sync fails, entries remain local with status 'failed' and can be retried later.",
			],
			parameters: Type.Object({}),
			execute: async () => {
				const result = await runtime.trySyncNow();
				return textResult(`Sync complete | ${formatSyncSummary(result)}`, result);
			},
		}),
	);
}
