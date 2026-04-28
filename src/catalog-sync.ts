import type { CatalogStore } from "./catalog-store.js";

export interface SyncApi {
  listResource(resource: string): Promise<unknown[]>;
}

export interface SyncResult {
  clients: number;
  projects: number;
  worktypes: number;
  modules: number;
}

function normalizeBoolean(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") {
    return val === "t" || val === "true" || val === "1";
  }
  return false;
}

function getString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string") return val;
  }
  return undefined;
}

function getNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const parsed = Number(val);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return undefined;
}

export async function syncProjectsCatalog(api: SyncApi, store: CatalogStore): Promise<SyncResult> {
  const rawClients = await api.listResource("client");
  const rawProjects = await api.listResource("project");
  const rawWorktypes = await api.listResource("projectworktype");
  const rawModules = await api.listResource("projectmodule");

  const clients = rawClients.map((c) => {
    const obj = c as Record<string, unknown>;
    return {
      id: getNumber(obj, "id") ?? 0,
      name: getString(obj, "name") ?? "",
      active: normalizeBoolean(obj.active),
      raw: c,
    };
  });

  const projects = rawProjects.map((p) => {
    const obj = p as Record<string, unknown>;
    return {
      id: getNumber(obj, "id") ?? 0,
      clientId: getNumber(obj, "clientid", "client_id") ?? undefined,
      name: getString(obj, "name") ?? "",
      active: normalizeBoolean(obj.active),
      billable: normalizeBoolean(obj.billable),
      raw: p,
    };
  });

  const worktypes = rawWorktypes.map((w) => {
    const obj = w as Record<string, unknown>;
    return {
      id: getNumber(obj, "id") ?? 0,
      projectId: getNumber(obj, "projectid", "project_id") ?? 0,
      worktypeId: getNumber(obj, "worktypeid", "worktype_id") ?? undefined,
      name: getString(obj, "worktype", "name", "worktypename") ?? "",
      active: normalizeBoolean(obj.active),
      raw: w,
    };
  });

  const modules = rawModules.map((m) => {
    const obj = m as Record<string, unknown>;
    return {
      id: getNumber(obj, "id") ?? 0,
      projectId: getNumber(obj, "projectid", "project_id") ?? 0,
      moduleId: getNumber(obj, "moduleid", "module_id") ?? undefined,
      name: getString(obj, "module", "name", "modulename") ?? "",
      active: normalizeBoolean(obj.active),
      raw: m,
    };
  });

  store.replaceCatalog({ clients, projects, worktypes, modules });

  return {
    clients: clients.length,
    projects: projects.length,
    worktypes: worktypes.length,
    modules: modules.length,
  };
}
