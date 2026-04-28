import { randomUUID } from "node:crypto";
import type { CatalogStore } from "./catalog-store.js";
import type { Db } from "./db.js";
import { resolveDateRange } from "./date-ranges.js";
import type { ProjectDefaultsStore } from "./project-defaults-store.js";
import type { TimeEntry, TimeEntryStore } from "./time-entry-store.js";
import type { TimeRange } from "./types.js";

export interface AddTimeInput {
  projectId: number;
  worktypeId?: number;
  moduleId?: number;
  date: string;
  durationSeconds: number;
  description?: string;
  billable?: boolean;
}

export interface QueryTimeInput {
  range: TimeRange;
  start_date?: string;
  end_date?: string;
  projectId?: number;
  projectQuery?: string;
  now?: Date;
}

export interface TimeReportEntry extends TimeEntry {
  projectName: string;
  worktypeName: string;
  moduleName?: string;
}

export interface TimeReport {
  startDate: string;
  endDate: string;
  totalSeconds: number;
  entries: TimeReportEntry[];
  byProject: Array<{
    projectId: number;
    projectName: string;
    totalSeconds: number;
  }>;
}

export class TimeService {
  constructor(
    private readonly deps: {
      db: Db;
      timeEntryStore: TimeEntryStore;
      catalogStore: CatalogStore;
      defaultsStore: ProjectDefaultsStore;
    },
  ) {}

  addTime(input: AddTimeInput): TimeEntry {
    const resolved = this.deps.defaultsStore.resolveForProject({
      projectId: input.projectId,
      worktypeId: input.worktypeId,
      moduleId: input.moduleId,
    });

    const worktypeId = resolved.worktypeId;
    if (worktypeId == null) {
      throw new Error("worktype is required");
    }

    const now = new Date().toISOString();
    return this.deps.timeEntryStore.insertTimeEntry({
      localId: randomUUID(),
      projectId: input.projectId,
      worktypeId,
      moduleId: resolved.moduleId,
      date: input.date,
      durationSeconds: input.durationSeconds,
      description: input.description,
      billable: input.billable,
      createdAt: now,
      updatedAt: now,
    });
  }

  queryTime(input: QueryTimeInput): TimeReport {
    if (input.projectId != null && input.projectQuery != null) {
      throw new Error("cannot specify both projectId and projectQuery");
    }

    const { startDate, endDate } = resolveDateRange({
      range: input.range,
      start_date: input.start_date,
      end_date: input.end_date,
      now: input.now,
    });

    let projectId = input.projectId;
    if (input.projectQuery != null) {
      const matches = this.deps.catalogStore.searchProjectContext({ query: input.projectQuery, limit: 5 });
      if (matches.length === 0) {
        throw new Error(`no project found for query: ${input.projectQuery}`);
      }
      if (matches.length > 1) {
        throw new Error(`project query is ambiguous: ${input.projectQuery} (${matches.length} matches)`);
      }
      projectId = matches[0].projectId;
    }

    const rawEntries = this.deps.timeEntryStore.queryTime({ startDate, endDate, projectId });
    const entries: TimeReportEntry[] = rawEntries.map((entry) => {
      const project = this.deps.catalogStore.getProject(entry.projectId);
      const worktype = this.deps.catalogStore.getWorktype(entry.projectId, entry.worktypeId);
      const mod = entry.moduleId != null ? this.deps.catalogStore.getModule(entry.projectId, entry.moduleId) : undefined;
      return {
        ...entry,
        projectName: project?.name ?? `Project ${entry.projectId}`,
        worktypeName: worktype?.name ?? `Worktype ${entry.worktypeId}`,
        moduleName: mod?.name,
      };
    });

    const projectTotals = new Map<number, { projectId: number; projectName: string; totalSeconds: number }>();
    for (const entry of entries) {
      const existing = projectTotals.get(entry.projectId);
      if (existing) {
        existing.totalSeconds += entry.durationSeconds;
      } else {
        projectTotals.set(entry.projectId, {
          projectId: entry.projectId,
          projectName: entry.projectName,
          totalSeconds: entry.durationSeconds,
        });
      }
    }

    return {
      startDate,
      endDate,
      totalSeconds: entries.reduce((sum, e) => sum + e.durationSeconds, 0),
      entries,
      byProject: Array.from(projectTotals.values()),
    };
  }
}
