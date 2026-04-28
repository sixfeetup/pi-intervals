import type { Db } from "./db.js";
import type { SyncStatus } from "./types.js";

export interface TimeEntry {
  localId: string;
  remoteId?: number;
  sourceTimerId?: string;
  projectId: number;
  worktypeId: number;
  moduleId?: number;
  date: string;
  startAt?: string;
  endAt?: string;
  durationSeconds: number;
  description?: string;
  billable: boolean;
  syncStatus: SyncStatus;
  syncAttempts: number;
  lastSyncError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsertTimeEntryInput {
  localId: string;
  remoteId?: number;
  sourceTimerId?: string;
  projectId: number;
  worktypeId: number;
  moduleId?: number;
  date: string;
  startAt?: string;
  endAt?: string;
  durationSeconds: number;
  description?: string;
  billable?: boolean;
  syncStatus?: SyncStatus;
  createdAt: string;
  updatedAt: string;
}

export class TimeEntryStore {
  constructor(private readonly db: Db) {}

  insertTimeEntry(input: InsertTimeEntryInput): TimeEntry {
    this.db.prepare(
      `insert into time_entries (
        local_id, remote_id, source_timer_id,
        project_id, worktype_id, module_id,
        date, start_at, end_at, duration_seconds,
        description, billable, sync_status,
        sync_attempts, last_sync_error, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.localId,
      input.remoteId ?? null,
      input.sourceTimerId ?? null,
      input.projectId,
      input.worktypeId,
      input.moduleId ?? null,
      input.date,
      input.startAt ?? null,
      input.endAt ?? null,
      input.durationSeconds,
      input.description ?? null,
      input.billable === false ? 0 : 1,
      input.syncStatus ?? "pending",
      0,
      null,
      input.createdAt,
      input.updatedAt
    );
    return this.getTimeEntry(input.localId)!;
  }

  getTimeEntry(localId: string): TimeEntry | undefined {
    const row = this.db.prepare(
      `select
        local_id as localId,
        remote_id as remoteId,
        source_timer_id as sourceTimerId,
        project_id as projectId,
        worktype_id as worktypeId,
        module_id as moduleId,
        date,
        start_at as startAt,
        end_at as endAt,
        duration_seconds as durationSeconds,
        description,
        billable,
        sync_status as syncStatus,
        sync_attempts as syncAttempts,
        last_sync_error as lastSyncError,
        created_at as createdAt,
        updated_at as updatedAt
      from time_entries where local_id = ?`
    ).get(localId) as
      | {
          localId: string;
          remoteId: number | null;
          sourceTimerId: string | null;
          projectId: number;
          worktypeId: number;
          moduleId: number | null;
          date: string;
          startAt: string | null;
          endAt: string | null;
          durationSeconds: number;
          description: string | null;
          billable: number;
          syncStatus: SyncStatus;
          syncAttempts: number;
          lastSyncError: string | null;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;
    if (!row) return undefined;
    return this.mapRow(row);
  }

  listRecent({ limit = 20 }: { limit?: number } = {}): TimeEntry[] {
    const rows = this.db.prepare(
      `select
        local_id as localId,
        remote_id as remoteId,
        source_timer_id as sourceTimerId,
        project_id as projectId,
        worktype_id as worktypeId,
        module_id as moduleId,
        date,
        start_at as startAt,
        end_at as endAt,
        duration_seconds as durationSeconds,
        description,
        billable,
        sync_status as syncStatus,
        sync_attempts as syncAttempts,
        last_sync_error as lastSyncError,
        created_at as createdAt,
        updated_at as updatedAt
      from time_entries order by updated_at desc limit ?`
    ).all(limit) as Array<{
      localId: string;
      remoteId: number | null;
      sourceTimerId: string | null;
      projectId: number;
      worktypeId: number;
      moduleId: number | null;
      date: string;
      startAt: string | null;
      endAt: string | null;
      durationSeconds: number;
      description: string | null;
      billable: number;
      syncStatus: SyncStatus;
      syncAttempts: number;
      lastSyncError: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: {
    localId: string;
    remoteId: number | null;
    sourceTimerId: string | null;
    projectId: number;
    worktypeId: number;
    moduleId: number | null;
    date: string;
    startAt: string | null;
    endAt: string | null;
    durationSeconds: number;
    description: string | null;
    billable: number;
    syncStatus: SyncStatus;
    syncAttempts: number;
    lastSyncError: string | null;
    createdAt: string;
    updatedAt: string;
  }): TimeEntry {
    return {
      localId: row.localId,
      remoteId: row.remoteId ?? undefined,
      sourceTimerId: row.sourceTimerId ?? undefined,
      projectId: row.projectId,
      worktypeId: row.worktypeId,
      moduleId: row.moduleId ?? undefined,
      date: row.date,
      startAt: row.startAt ?? undefined,
      endAt: row.endAt ?? undefined,
      durationSeconds: row.durationSeconds,
      description: row.description ?? undefined,
      billable: row.billable === 1,
      syncStatus: row.syncStatus,
      syncAttempts: row.syncAttempts,
      lastSyncError: row.lastSyncError ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
