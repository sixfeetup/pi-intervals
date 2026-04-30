import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { getIntervalsHome, loadConfig, resolveCredentials, saveConfig } from "./config.js";
import { syncProjectsCatalog } from "./catalog-sync.js";
import { IntervalsApiClient } from "./intervals-api.js";
import { formatBrightTimer, formatDuration, formatSyncSummary, formatTimeEntry, formatTimeReport } from "./format.js";
import type { Runtime } from "./runtime.js";
import type { TimeRange } from "./types.js";

export function registerIntervalsCommands(runtime: Runtime, pi: ExtensionAPI): void {
  pi.registerCommand("intervals-setup", {
    description: "Configure Intervals API credentials and run initial project sync",
    handler: async (_args, ctx) => {
      const status = runtime.status();
      const home = status.home;

      if (status.credentialSource === "env") {
        ctx.ui.notify(`Intervals credentials loaded from environment. Database: ${home}`, "info");
        try {
          const result = await runtime.syncProjectsCatalog();
          ctx.ui.notify(
            `Project sync complete: ${result.projects} projects, ${result.worktypes} worktypes, ${result.modules} modules, ${result.clients} clients`,
            "info",
          );
        } catch (err) {
          ctx.ui.notify(`Project sync failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
        return;
      }

      if (status.credentialSource === "config") {
        ctx.ui.notify(`Intervals credentials loaded from config file. Database: ${home}`, "info");
        try {
          const result = await runtime.syncProjectsCatalog();
          ctx.ui.notify(
            `Project sync complete: ${result.projects} projects, ${result.worktypes} worktypes, ${result.modules} modules, ${result.clients} clients`,
            "info",
          );
        } catch (err) {
          ctx.ui.notify(`Project sync failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify(
          "Intervals credentials are not configured. Set INTERVALS_API_KEY or run this command in interactive mode.",
          "error",
        );
        return;
      }

      const apiKey = await ctx.ui.input("Intervals API key:");
      if (!apiKey) {
        ctx.ui.notify("Setup cancelled: API key is required.", "error");
        return;
      }

      const personIdStr = await ctx.ui.input("Intervals person ID (optional):");
      const parsedPersonId = personIdStr ? Number(personIdStr) : undefined;
      if (personIdStr && !Number.isFinite(parsedPersonId)) {
        ctx.ui.notify("Setup cancelled: person ID must be a valid number.", "error");
        return;
      }
      const personId = parsedPersonId;

      const config = loadConfig(home);
      saveConfig(home, {
        ...config,
        apiKey,
        personId: personId ?? config.personId,
      });

      ctx.ui.notify(`Credentials saved to ${home}/config.json`, "info");
      runtime.reloadCredentials();

      try {
        const result = await runtime.syncProjectsCatalog();
        ctx.ui.notify(
          `Project sync complete: ${result.projects} projects, ${result.worktypes} worktypes, ${result.modules} modules, ${result.clients} clients`,
          "info",
        );
      } catch (err) {
        ctx.ui.notify(`Project sync failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  pi.registerCommand("intervals-sync-projects", {
    description: "Sync Intervals project catalog (clients, projects, worktypes, modules)",
    handler: async (_args, ctx) => {
      if (!runtime.status().credentialsConfigured) {
        ctx.ui.notify("Intervals credentials are not configured. Run /intervals-setup first.", "error");
        return;
      }
      try {
        const result = await runtime.syncProjectsCatalog();
        ctx.ui.notify(
          `Project sync complete: ${result.projects} projects, ${result.worktypes} worktypes, ${result.modules} modules, ${result.clients} clients`,
          "info",
        );
      } catch (err) {
        ctx.ui.notify(`Project sync failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  pi.registerCommand("intervals-sync-now", {
    description: "Sync pending local time entries to Intervals now",
    handler: async (_args, ctx) => {
      const status = runtime.status();
      if (!status.credentialsConfigured || !status.personId) {
        ctx.ui.notify("Intervals credentials or person ID are not configured. Run /intervals-setup first.", "error");
        return;
      }
      const result = await runtime.trySyncNow();
      ctx.ui.notify(`Sync complete | ${formatSyncSummary(result)}`, "info");
    },
  });

  pi.registerCommand("intervals-status", {
    description: "Show Intervals extension status",
    handler: async (_args, ctx) => {
      const status = runtime.status();
      const activeTimers = runtime.timerStore.listActive().length;
      const pendingSync = runtime.timeEntryStore.pendingForSync().length;
      const lastSync = runtime.catalogStore.getLastProjectSync();
      const source = status.credentialSource ?? "none";
      const lines = [
        `Database: ${status.home}`,
        `Credentials: ${source}`,
        `active timers: ${activeTimers}`,
        `pending sync: ${pendingSync}`,
        `last project sync: ${lastSync ?? "never"}`,
      ];
      ctx.ui.notify(lines.join(" | "), "info");
    },
  });

  pi.registerCommand("intervals-timers", {
    description: "Show active or recent timers",
    handler: async (args, ctx) => {
      const arg = args.trim();

      if (arg.startsWith("edit ")) {
        const tokens = arg.slice(5).split(/\s+/);
        const localId = tokens[0];
        if (!localId) {
          ctx.ui.notify("Usage: /intervals-timers edit <timer_id> [project_id=...] [worktype_id=...] [module_id=...|null]", "error");
          return;
        }

        const patch: Record<string, unknown> = { localId };
        for (const token of tokens.slice(1)) {
          const eq = token.indexOf("=");
          if (eq === -1) {
            ctx.ui.notify(`Invalid token (expected field=value): ${token}`, "error");
            return;
          }
          const key = token.slice(0, eq);
          const value = token.slice(eq + 1);
          if (key === "project_id") {
            const num = Number(value);
            if (!Number.isFinite(num)) {
              ctx.ui.notify(`Invalid numeric value for project_id: ${value}`, "error");
              return;
            }
            patch.projectId = num;
          } else if (key === "worktype_id") {
            const num = Number(value);
            if (!Number.isFinite(num)) {
              ctx.ui.notify(`Invalid numeric value for worktype_id: ${value}`, "error");
              return;
            }
            patch.worktypeId = num;
          } else if (key === "module_id") {
            if (value === "" || value === "null") {
              patch.moduleId = null;
            } else {
              const num = Number(value);
              if (!Number.isFinite(num)) {
                ctx.ui.notify(`Invalid numeric value for module_id: ${value}`, "error");
                return;
              }
              patch.moduleId = num;
            }
          } else {
            ctx.ui.notify(`Unknown field: ${key}`, "error");
            return;
          }
        }

        try {
          const timer = runtime.timerService.editTimer(patch as any);
          ctx.ui.notify(`Timer updated\n${formatBrightTimer(timer)}`, "info");
        } catch (err) {
          ctx.ui.notify(`Timer edit failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
        return;
      }

      if (arg.startsWith("delete ")) {
        const localId = arg.slice(7).trim();
        if (!localId) {
          ctx.ui.notify("Usage: /intervals-timers delete <timer_id>", "error");
          return;
        }

        try {
          const timer = runtime.timerService.deleteTimer({ localId });
          ctx.ui.notify(`Timer deleted\n${formatBrightTimer(timer)}`, "info");
        } catch (err) {
          ctx.ui.notify(`Timer delete failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
        return;
      }

      const timers = arg === "recent"
        ? runtime.timerStore.listRecent(10)
        : runtime.timerStore.listActive();
      if (timers.length === 0) {
        ctx.ui.notify("No timers found.", "info");
        return;
      }
      const lines = timers.map((t) => formatBrightTimer(t));
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("intervals-time", {
    description: "Query time entries by range or edit an entry",
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (trimmed.startsWith("edit ")) {
        const tokens = trimmed.slice(5).split(/\s+/);
        const localId = tokens[0];
        if (!localId) {
          ctx.ui.notify("Usage: /intervals-time edit <time_entry_id> [field=value ...]", "error");
          return;
        }

        const patch: Record<string, unknown> = { localId };
        for (const token of tokens.slice(1)) {
          const eq = token.indexOf("=");
          if (eq === -1) {
            ctx.ui.notify(`Invalid token (expected field=value): ${token}`, "error");
            return;
          }
          const key = token.slice(0, eq);
          const value = token.slice(eq + 1);

          if (key === "duration_minutes") {
            const num = Number(value);
            if (!Number.isFinite(num)) {
              ctx.ui.notify(`Invalid numeric value for duration_minutes: ${value}`, "error");
              return;
            }
            patch.durationSeconds = Math.round(num * 60);
          } else if (key === "project_id") {
            const num = Number(value);
            if (!Number.isFinite(num)) {
              ctx.ui.notify(`Invalid numeric value for project_id: ${value}`, "error");
              return;
            }
            patch.projectId = num;
          } else if (key === "worktype_id") {
            const num = Number(value);
            if (!Number.isFinite(num)) {
              ctx.ui.notify(`Invalid numeric value for worktype_id: ${value}`, "error");
              return;
            }
            patch.worktypeId = num;
          } else if (key === "module_id") {
            if (value === "" || value === "null") {
              patch.moduleId = null;
            } else {
              const num = Number(value);
              if (!Number.isFinite(num)) {
                ctx.ui.notify(`Invalid numeric value for module_id: ${value}`, "error");
                return;
              }
              patch.moduleId = num;
            }
          } else if (key === "billable") {
            patch.billable = value === "true" || value === "1";
          } else if (key === "description") {
            patch.description = value;
          } else if (key === "date") {
            patch.date = value;
          } else if (key === "start_at") {
            patch.startAt = value === "" || value === "null" ? null : value;
          } else if (key === "end_at") {
            patch.endAt = value === "" || value === "null" ? null : value;
          } else {
            ctx.ui.notify(`Unknown field: ${key}`, "error");
            return;
          }
        }

        try {
          const entry = runtime.timeService.editTime(patch as any);
          const syncResult = await runtime.trySyncNow();
          const formattedEntry = formatTimeEntry({
            ...entry,
            projectName: runtime.catalogStore.getProject(entry.projectId)?.name,
            worktypeName: runtime.catalogStore.getWorktype(entry.projectId, entry.worktypeId)?.name,
            moduleName: entry.moduleId != null
              ? runtime.catalogStore.getModule(entry.projectId, entry.moduleId)?.name
              : undefined,
          });
          ctx.ui.notify(
            `Updated ${entry.localId.slice(0, 8)}\n${formattedEntry}\n${formatSyncSummary(syncResult)}`,
            "info",
          );
        } catch (err) {
          ctx.ui.notify(`Edit failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
        return;
      }

      let range: TimeRange = "today";
      let startDate: string | undefined;
      let endDate: string | undefined;

      const arg = trimmed || "today";

      if (arg === "today") range = "today";
      else if (arg === "this-week") range = "this_week";
      else if (arg === "last-week") range = "last_week";
      else if (arg === "this-month") range = "this_month";
      else if (arg === "last-month") range = "last_month";
      else if (arg.includes("..")) {
        const [start, end] = arg.split("..");
        range = "custom";
        startDate = start;
        endDate = end;
      } else {
        ctx.ui.notify(
          `Unknown range: ${arg}. Use today, this-week, last-week, this-month, last-month, or YYYY-MM-DD..YYYY-MM-DD`,
          "error",
        );
        return;
      }

      try {
        const report = runtime.timeService.queryTime({ range, start_date: startDate, end_date: endDate });
        const label = range.replace(/_/g, "-");
        ctx.ui.notify(`${label}\n${formatTimeReport(report)}`, "info");
      } catch (err) {
        ctx.ui.notify(`Query failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  pi.registerCommand("intervals-project-defaults", {
    description: "Set default worktype and optional module for a project",
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/);
      if (tokens.length < 2) {
        ctx.ui.notify("Usage: /intervals-project-defaults <project_id> <worktype_id> [module_id]", "error");
        return;
      }
      const projectId = Number(tokens[0]);
      const worktypeId = Number(tokens[1]);
      if (!Number.isFinite(projectId) || !Number.isFinite(worktypeId)) {
        ctx.ui.notify("Invalid project_id or worktype_id: must be valid numbers.", "error");
        return;
      }
      const moduleId = tokens[2] != null ? Number(tokens[2]) : undefined;
      if (tokens[2] != null && !Number.isFinite(moduleId!)) {
        ctx.ui.notify("Invalid module_id: must be a valid number.", "error");
        return;
      }

      runtime.defaultsStore.setProjectDefaults({
        projectId,
        defaultWorktypeId: worktypeId,
        defaultModuleId: moduleId,
      });

      ctx.ui.notify(`Project defaults set for ${projectId}: worktype=${worktypeId} module=${moduleId ?? "none"}`, "info");
    },
  });
}
