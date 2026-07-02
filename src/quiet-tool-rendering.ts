import { formatDuration } from "./format.js";
import { formatEditableLocalId } from "./local-id.js";

export function quietToolRenderer(toolName: string) {
  return {
    renderCall: () => textComponent(toolName),
    renderResult: (result: { details?: any; isError?: boolean }, _options: unknown, theme: any) => {
      const mark = result.isError ? color(theme, "error", "✕") : color(theme, "success", "✓");
      return textComponent(`${mark} ${toolName}${quietToolSuffix(toolName, result.details)}`);
    },
  };
}

function textComponent(text: string) {
  return {
    render: () => [text],
    invalidate: () => {},
  };
}

function color(theme: any, name: string, text: string): string {
  return typeof theme?.fg === "function" ? theme.fg(name, text) : text;
}

function quietToolSuffix(toolName: string, details: any): string {
  switch (toolName) {
    case "intervals_find_project_context":
      return countSuffix(details?.results?.length, "project");
    case "intervals_start_timer":
    case "intervals_edit_timer":
    case "intervals_delete_timer":
      return details?.timer?.localId ? ` · timer ${formatEditableLocalId(details.timer.localId)}` : "";
    case "intervals_stop_timer":
      return ` · stopped${durationSuffix(details?.entry?.durationSeconds)}${syncSuffix(details?.sync)}`;
    case "intervals_add_time":
    case "intervals_edit_time":
    case "intervals_delete_time":
      return details?.entry?.localId ? ` · entry ${formatEditableLocalId(details.entry.localId)}` : "";
    case "intervals_query_time":
      return details?.report
        ? ` · ${formatDuration(details.report.totalSeconds ?? 0)}${countSuffix(details.report.entries?.length, "entry")}`
        : "";
    case "intervals_list_timers":
      return timerCountSuffix(details?.timers);
    case "intervals_lookup_time_entry":
      return details?.timeEntryId ? ` · ${details.timeEntryId}` : "";
    case "intervals_list_time":
      return countSuffix(details?.entries?.length, "entry");
    case "intervals_set_project_defaults":
      return " · saved";
    case "intervals_sync_now":
      return syncSuffix(details);
    default:
      return "";
  }
}

function durationSuffix(seconds: unknown): string {
  return typeof seconds === "number" ? ` ${formatDuration(seconds)}` : "";
}

function countSuffix(count: unknown, noun: string): string {
  if (typeof count !== "number") return "";
  const plural = noun === "entry" ? "entries" : `${noun}s`;
  return ` · ${count} ${count === 1 ? noun : plural}`;
}

function timerCountSuffix(timers: unknown): string {
  if (!Array.isArray(timers)) return "";
  const active = timers.filter((timer) => timer?.state === "active").length;
  return ` · ${active > 0 ? `${active} active` : `${timers.length} timer${timers.length === 1 ? "" : "s"}`}`;
}

function syncSuffix(sync: any): string {
  if (!sync) return "";
  if (typeof sync.failed === "number" && sync.failed > 0) return ` · sync failed=${sync.failed}`;
  if (typeof sync.timeEntriesCreated === "number" || typeof sync.timeEntriesUpdated === "number") return " · synced";
  return "";
}
