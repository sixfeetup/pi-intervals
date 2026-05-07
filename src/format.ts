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
const ANSI_BRIGHT_RED = "\u001b[91m";
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

export function formatTimeReport(report: TimeReport, options: { label?: string } = {}): string {
  const singleDay = report.startDate === report.endDate;
  const period = singleDay ? report.startDate : `${report.startDate} .. ${report.endDate}`;
  const label = options.label ? `${options.label}  ` : "";
  const lines: string[] = [
    `${ANSI_BRIGHT_CYAN}${label}${period}${ANSI_RESET}  ${ANSI_BRIGHT_YELLOW}Total: ${formatDuration(report.totalSeconds)}${ANSI_RESET} ${ANSI_DIM}· ${report.entries.length} ${pluralize(report.entries.length, "entry", "entries")} · ${report.byProject.length} ${pluralize(report.byProject.length, "project", "projects")}${ANSI_RESET}`,
  ];

  for (const group of [...report.byProject].sort((a, b) => b.totalSeconds - a.totalSeconds)) {
    const entries = report.entries
      .filter((entry) => entry.projectId === group.projectId)
      .sort(compareTimeReportEntries);

    lines.push("");
    lines.push(`${ANSI_BRIGHT_GREEN}● ${group.projectName}${ANSI_RESET}  ${ANSI_BRIGHT_YELLOW}${formatDuration(group.totalSeconds)}${ANSI_RESET}`);

    const classification = formatSharedClassification(entries);
    if (classification) {
      lines.push(`  ${ANSI_DIM}${classification}${ANSI_RESET}`);
    }

    for (const entry of entries) {
      lines.push(formatTimeReportEntryRow(entry, { includeDate: !singleDay }));
    }
  }

  return lines.join("\n");
}

function compareTimeReportEntries(a: TimeReport["entries"][number], b: TimeReport["entries"][number]): number {
  return `${a.date} ${a.startAt ?? ""} ${a.createdAt}`.localeCompare(`${b.date} ${b.startAt ?? ""} ${b.createdAt}`);
}

function formatSharedClassification(entries: TimeReport["entries"]): string {
  const labels = new Set(entries.map((entry) => {
    const parts = [entry.moduleName, entry.worktypeName].filter(Boolean);
    return parts.join(" · ");
  }).filter(Boolean));

  if (labels.size !== 1) return "";
  return [...labels][0];
}

function formatTimeReportEntryRow(entry: TimeReport["entries"][number], options: { includeDate: boolean }): string {
  const id = formatEditableLocalId(entry.localId);
  const date = options.includeDate ? `${entry.date} ` : "";
  const window = formatTimeEntryWindow(entry);
  const windowPart = window ? `${window} ` : "";
  const description = entry.description || "(no description)";
  const failedError = entry.syncStatus === "failed" && entry.lastSyncError ? ` (${entry.lastSyncError})` : "";

  return `  ${ANSI_BRIGHT_CYAN}${id}${ANSI_RESET}  ${ANSI_DIM}${date}${windowPart}${ANSI_RESET}${ANSI_BRIGHT_YELLOW}${formatDuration(entry.durationSeconds)}${ANSI_RESET} ${formatSyncStatusSymbol(entry.syncStatus)} ${description}${failedError}`;
}

function formatSyncStatusSymbol(status: TimeEntry["syncStatus"]): string {
  if (status === "synced") return `${ANSI_BRIGHT_GREEN}✓${ANSI_RESET}`;
  if (status === "pending") return `${ANSI_BRIGHT_YELLOW}●${ANSI_RESET}`;
  if (status === "failed") return `${ANSI_BRIGHT_RED}✕${ANSI_RESET}`;
  return `${ANSI_BRIGHT_YELLOW}!${ANSI_RESET}`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function formatSyncSummary(summary: SyncPendingResult): string {
  return `created=${summary.timeEntriesCreated} updated=${summary.timeEntriesUpdated} failed=${summary.failed}`;
}
