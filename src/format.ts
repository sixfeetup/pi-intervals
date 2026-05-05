import type { Timer } from "./timer-store.js";
import type { TimeEntry } from "./time-entry-store.js";
import type { TimeReport } from "./time-service.js";
import type { SyncPendingResult } from "./sync-service.js";
import { formatEditableLocalId } from "./local-id.js";
import { formatTimeEntryWindow } from "./time-window.js";

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

export function formatTimer(timer: Timer, now = new Date()): string {
  const id = timer.localId.slice(0, 8);
  const dur = formatDuration(getTimerElapsedSeconds(timer, now));
  return `${id} ${timer.state} ${dur} ${timer.description}`;
}

const ANSI_RESET = "\u001b[0m";
const ANSI_BRIGHT_GREEN = "\u001b[92m";
const ANSI_BRIGHT_YELLOW = "\u001b[93m";
const ANSI_BRIGHT_CYAN = "\u001b[96m";
const ANSI_DIM = "\u001b[2m";

export function formatBrightTimer(timer: Timer, now = new Date()): string {
  const id = timer.localId.slice(0, 8);
  const dur = formatDuration(getTimerElapsedSeconds(timer, now));
  const statusColor = timer.state === "active" ? ANSI_BRIGHT_GREEN : ANSI_DIM;
  return `${statusColor}● ${timer.state}${ANSI_RESET}  ${ANSI_BRIGHT_YELLOW}${dur}${ANSI_RESET}  ${ANSI_BRIGHT_CYAN}${id}${ANSI_RESET}  ${timer.description}`;
}

function getTimerElapsedSeconds(timer: Timer, now: Date): number {
  if (timer.state !== "active") return timer.elapsedSeconds;

  const startedAt = new Date(timer.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return timer.elapsedSeconds;

  return Math.max(0, Math.floor((now.getTime() - startedAt) / 1000));
}

export function formatTimeEntry(
  entry: TimeEntry & { projectName?: string; worktypeName?: string; moduleName?: string },
): string {
  const id = formatEditableLocalId(entry.localId);
  const window = formatTimeEntryWindow(entry);
  const windowPart = window ? ` ${window}` : "";
  const dur = formatDuration(entry.durationSeconds);
  const project = entry.projectName ?? `Project ${entry.projectId}`;
  const worktype = entry.worktypeName ?? `Worktype ${entry.worktypeId}`;
  const mod = entry.moduleName ? `/${entry.moduleName}` : "";
  const desc = entry.description ? ` | ${entry.description}` : "";
  let line = `${id} ${entry.date}${windowPart} ${dur} ${project}${mod} (${worktype})${desc}`;
  if (entry.syncStatus === "failed" && entry.lastSyncError) {
    line += ` [failed: ${entry.lastSyncError}]`;
  } else {
    line += ` [${entry.syncStatus}]`;
  }
  return line;
}

export function formatTimeReport(report: TimeReport): string {
  const lines: string[] = [];
  lines.push(`${report.startDate} .. ${report.endDate} | Total: ${formatDuration(report.totalSeconds)}`);
  for (const group of report.byProject) {
    lines.push(`  ${group.projectName}: ${formatDuration(group.totalSeconds)}`);
  }
  if (report.entries.length > 0) {
    lines.push("");
    for (const entry of report.entries) {
      lines.push(`  ${formatTimeEntry(entry)}`);
    }
  }
  return lines.join("\n");
}

export function formatSyncSummary(summary: SyncPendingResult): string {
  return `created=${summary.timeEntriesCreated} updated=${summary.timeEntriesUpdated} failed=${summary.failed}`;
}
