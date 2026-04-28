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

export interface TimeReport {
  startDate: string;
  endDate: string;
  totalSeconds: number;
  entries: TimeEntry[];
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

    const entries = this.deps.timeEntryStore.queryTime({ startDate, endDate, projectId });

    const projectTotals = new Map<number, { projectId: number; projectName: string; totalSeconds: number }>();
    for (const entry of entries) {
      const existing = projectTotals.get(entry.projectId);
      if (existing) {
        existing.totalSeconds += entry.durationSeconds;
      } else {
        const project = this.deps.catalogStore.getProject(entry.projectId);
        projectTotals.set(entry.projectId, {
          projectId: entry.projectId,
          projectName: project?.name ?? `Project ${entry.projectId}`,
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
