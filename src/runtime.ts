import { CatalogStore } from "./catalog-store.js";
import {
  databasePath,
  getIntervalsHome,
  loadConfig,
  resolveCredentials,
  resolvePersonId,
} from "./config.js";
import { openDatabase, type Db } from "./db.js";
import { IntervalsApiClient } from "./intervals-api.js";
import { ProjectDefaultsStore } from "./project-defaults-store.js";
import { syncPending } from "./sync-service.js";
import { TimeEntryStore } from "./time-entry-store.js";
import { TimeService } from "./time-service.js";
import { TimerService } from "./timer-service.js";
import { TimerStore } from "./timer-store.js";

export interface RuntimeOptions {
  env?: NodeJS.ProcessEnv;
}

export interface RuntimeStatus {
  home: string;
  credentialsConfigured: boolean;
  dbOpen: boolean;
  personId?: number;
  apiClient?: boolean;
}

export interface Runtime {
  status(): RuntimeStatus;
  close(): void;
  trySyncNow(): Promise<{ timeEntriesCreated: number; timeEntriesUpdated: number; failed: number }>;
  catalogStore: CatalogStore;
  defaultsStore: ProjectDefaultsStore;
  timerStore: TimerStore;
  timeEntryStore: TimeEntryStore;
  timerService: TimerService;
  timeService: TimeService;
  syncService: { syncPending: typeof syncPending };
}

export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const env = options.env ?? process.env;
  const home = getIntervalsHome(env);
  const config = loadConfig(home);
  const credentials = resolveCredentials(config, env);
  const personId = resolvePersonId(config, env);

  const db = openDatabase(databasePath(home));
  const catalogStore = new CatalogStore(db);
  const defaultsStore = new ProjectDefaultsStore(db);
  const timerStore = new TimerStore(db);
  const timeEntryStore = new TimeEntryStore(db);

  const apiClient = credentials
    ? new IntervalsApiClient({ apiKey: credentials.apiKey, baseUrl: credentials.baseUrl })
    : undefined;

  const timerService = new TimerService(timerStore, timeEntryStore, defaultsStore, catalogStore);
  const timeService = new TimeService({
    db,
    timeEntryStore,
    catalogStore,
    defaultsStore,
  });

  const syncService = {
    syncPending,
  };

  async function trySyncNow(): Promise<{ timeEntriesCreated: number; timeEntriesUpdated: number; failed: number }> {
    if (!apiClient || !personId) {
      return { timeEntriesCreated: 0, timeEntriesUpdated: 0, failed: 0 };
    }
    return syncPending({
      timeRepo: timeEntryStore,
      api: apiClient,
      personId,
      limit: 50,
    });
  }

  function status(): RuntimeStatus {
    return {
      home,
      credentialsConfigured: credentials != null,
      dbOpen: db.open,
      personId: personId ?? undefined,
      apiClient: apiClient != null,
    };
  }

  function close(): void {
    if (db.open) {
      db.close();
    }
  }

  return {
    status,
    close,
    trySyncNow,
    catalogStore,
    defaultsStore,
    timerStore,
    timeEntryStore,
    timerService,
    timeService,
    syncService,
  };
}
