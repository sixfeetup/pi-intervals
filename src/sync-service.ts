import type { TimeEntryStore } from "./time-entry-store.js";

export interface SyncApi {
  createResource(resource: string, body: Record<string, unknown>): Promise<unknown>;
  updateResource(resource: string, id: number, body: Record<string, unknown>): Promise<unknown>;
}

export interface SyncPendingOptions {
  timeRepo: TimeEntryStore;
  api: SyncApi;
  personId?: number;
  limit?: number;
}

export interface SyncPendingResult {
  timeEntriesCreated: number;
  timeEntriesUpdated: number;
  failed: number;
}

export async function syncPending(options: SyncPendingOptions): Promise<SyncPendingResult> {
  const { timeRepo, api, personId, limit = 20 } = options;
  const entries = timeRepo.pendingForSync(limit);

  let timeEntriesCreated = 0;
  let timeEntriesUpdated = 0;
  let failed = 0;

  for (const entry of entries) {
    if (personId == null) {
      timeRepo.markSyncFailed(entry.localId, "Missing personId: set INTERVALS_PERSON_ID or run /intervals-setup to configure your Intervals person ID.");
      failed++;
      continue;
    }

    const payload: Record<string, unknown> = {
      projectid: entry.projectId,
      worktypeid: entry.worktypeId,
      personid: personId,
      date: entry.date,
      time: entry.durationSeconds / 3600,
      description: entry.description ?? "",
      billable: entry.billable ? "t" : "f",
    };

    if (entry.moduleId != null) {
      payload.moduleid = entry.moduleId;
    }

    try {
      if (entry.remoteId == null) {
        const response = await api.createResource("time", payload);
        const remoteId = extractRemoteId(response);
        if (remoteId != null) {
          timeRepo.setRemoteTime(entry.localId, remoteId);
        } else {
          timeRepo.markSyncFailed(entry.localId, "Could not extract remote ID from create response");
          failed++;
          continue;
        }
        timeEntriesCreated++;
      } else {
        await api.updateResource("time", entry.remoteId, payload);
        timeRepo.setRemoteTime(entry.localId, entry.remoteId);
        timeEntriesUpdated++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      timeRepo.markSyncFailed(entry.localId, sanitizeSyncError(message));
      failed++;
    }
  }

  return { timeEntriesCreated, timeEntriesUpdated, failed };
}

function extractRemoteId(response: unknown): number | undefined {
  if (response == null) return undefined;
  if (typeof response === "object") {
    const obj = response as Record<string, unknown>;
    const top = toNumber(obj.id);
    if (top != null) return top;
    const nested = obj.time;
    if (nested != null && typeof nested === "object") {
      const timeObj = nested as Record<string, unknown>;
      const nestedId = toNumber(timeObj.id);
      if (nestedId != null) return nestedId;
    }
  }
  return undefined;
}

function toNumber(val: unknown): number | undefined {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = Number(val);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function sanitizeSyncError(message: string): string {
  return message.replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [redacted]");
}
