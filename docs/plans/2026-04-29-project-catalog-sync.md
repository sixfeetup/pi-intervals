# Project Catalog Sync Implementation Plan

**Goal:** Fix Intervals project catalog sync so `/intervals-sync-projects` and `/intervals-setup` load the complete active project catalog, including active worktypes and modules, into the local SQLite catalog.
**Architecture:** Make `IntervalsApiClient.listResource()` page through all Intervals API result pages instead of accepting the default first page. Keep catalog normalization/filtering in `catalog-sync.ts`: normalize API records, retain active projects only, and retain worktypes/modules only for retained active projects. Keep command behavior thin by having `/intervals-setup` call the same runtime catalog sync path immediately after credentials are available.
**Tech Stack:** TypeScript, Node 22 `node:test`, local SQLite via `node:sqlite`, pi extension commands/tools, Intervals REST API.

## Current Findings

- Local catalog only contains 10 projects, alphabetically from `ADA` to `ARKP`, which strongly indicates the Intervals `project/` endpoint is returning its default first page only.
- `src/intervals-api.ts` currently calls `GET <resource>/` exactly once in `listResource()`.
- `src/catalog-sync.ts` currently stores every returned project, including inactive projects, because it normalizes `active` but does not filter by it.
- `/intervals-setup` in `src/commands.ts` already attempts `runtime.syncProjectsCatalog()` in the env, config, and interactive-save branches. This should remain true and get regression coverage so the agent can query the catalog immediately after setup.

## Desired Behavior

1. `IntervalsApiClient.listResource("project")` returns all pages, not just the API default first page.
2. Catalog sync stores active projects only.
3. Catalog sync stores worktypes/modules only when:
   - the worktype/module itself is active, and
   - its `projectid` belongs to a retained active project.
4. `/intervals-setup` immediately syncs the full catalog after credentials are available, including after interactive credential save.
5. `/intervals-sync-projects` and `/intervals-setup` success notifications report counts from the retained active catalog.

---

### Task 1: Add failing pagination coverage for `IntervalsApiClient.listResource()`

**Files:**
- Modify: `tests/intervals-api.test.ts`
- Modify later: `src/intervals-api.ts`

**Step 1: Write the failing test**

Append this test to `tests/intervals-api.test.ts`:

```ts
test("listResource follows limit/offset pagination until the final partial page", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    const limit = Number(parsed.searchParams.get("limit"));
    const offset = Number(parsed.searchParams.get("offset"));

    assert.equal(init?.method, "GET");
    assert.equal(limit, 100);

    const ids = offset === 0
      ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
      : offset === 100
        ? Array.from({ length: 100 }, (_, i) => ({ id: i + 101 }))
        : offset === 200
          ? [{ id: 201 }]
          : [];

    return new Response(JSON.stringify({ project: ids }), { status: 200 });
  };

  const api = new IntervalsApiClient({ apiKey: "secret", baseUrl: "https://api.example/", fetchImpl });
  const projects = await api.listResource("project");

  assert.equal(projects.length, 201);
  assert.deepEqual(projects.at(0), { id: 1 });
  assert.deepEqual(projects.at(-1), { id: 201 });
  assert.deepEqual(calls, [
    "https://api.example/project/?limit=100&offset=0",
    "https://api.example/project/?limit=100&offset=100",
    "https://api.example/project/?limit=100&offset=200",
  ]);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npx tsx --test tests/intervals-api.test.ts
```

Expected: FAIL because `listResource()` currently makes one request to `https://api.example/project/` without `limit`/`offset`, and returns only the first page.

**Step 3: Implement minimal pagination**

Modify `src/intervals-api.ts`:

```ts
export type IntervalsResource = "client" | "project" | "projectworktype" | "projectmodule" | "timer" | "time";

const PAGE_SIZE = 100;
const MAX_PAGES = 1000;

export class IntervalsApiClient {
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetchImpl?: typeof fetch }) {}

  async listResource(resource: IntervalsResource): Promise<unknown[]> {
    const items: unknown[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const data = await this.request("GET", resource, undefined, {
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const pageItems = extractCollection(data, resource);
      items.push(...pageItems);

      if (pageItems.length < PAGE_SIZE) return items;
    }

    throw new Error(`Exceeded ${MAX_PAGES} pages while fetching ${resource}`);
  }

  async createResource(resource: "timer" | "time", body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", resource, body);
  }

  async updateResource(resource: "timer" | "time", id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", `${resource}/${id}`, body);
  }

  private async request(
    method: string,
    resourcePath: string,
    body?: Record<string, unknown>,
    query?: Record<string, string>,
  ): Promise<unknown> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const base = this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`;
    const url = new URL(resourcePath.endsWith("/") ? resourcePath : `${resourcePath}/`, base);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${this.options.apiKey}:X`).toString("base64")}`,
    };
    if (body) headers["Content-Type"] = "application/json";

    const response = await fetchImpl(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new Error(sanitizeApiError(text || `${response.status} ${response.statusText}`, this.options.apiKey));
    return data;
  }
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
npx tsx --test tests/intervals-api.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/intervals-api.ts tests/intervals-api.test.ts
git commit -m "fix(api): fetch all catalog pages"
```

---

### Task 2: Update the existing API URL assertion for paginated list calls

**Files:**
- Modify: `tests/intervals-api.test.ts`

**Step 1: Update the existing test expectation**

In `api client fetches resource collections with json headers`, change:

```ts
assert.equal(calls[0].url, "https://api.example/client/");
```

to:

```ts
assert.equal(calls[0].url, "https://api.example/client/?limit=100&offset=0");
```

The fake response only returns one item, so pagination stops after one request.

**Step 2: Run focused tests**

Run:

```bash
npx tsx --test tests/intervals-api.test.ts
```

Expected: PASS.

**Step 3: Commit if Task 1 commit was not made separately**

If Task 1 was already committed, include this expectation change in the same commit before committing. Otherwise:

```bash
git add tests/intervals-api.test.ts
git commit -m "test(api): expect catalog list pagination parameters"
```

---

### Task 3: Add failing active-catalog filtering coverage

**Files:**
- Modify: `tests/catalog-sync.test.ts`
- Modify later: `src/catalog-sync.ts`

**Step 1: Write the failing test**

Append this test to `tests/catalog-sync.test.ts`:

```ts
test("syncProjectsCatalog stores active projects and their active classifications only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-intervals-sync-active-"));
  try {
    const db = openDatabase(join(dir, "intervals.db"));
    const store = new CatalogStore(db);
    const api = {
      listResource: async (resource: string) => {
        if (resource === "client") {
          return [
            { id: 1, name: "Active Client", active: "t" },
            { id: 2, name: "Inactive Client", active: "f" },
          ];
        }
        if (resource === "project") {
          return [
            { id: 10, clientid: 1, name: "SFUP043 Active", active: "t", billable: "t" },
            { id: 20, clientid: 2, name: "Old Inactive", active: "f", billable: "t" },
          ];
        }
        if (resource === "projectworktype") {
          return [
            { id: 100, projectid: 10, worktypeid: 5, worktype: "Development", active: "t" },
            { id: 101, projectid: 10, worktypeid: 6, worktype: "Inactive Worktype", active: "f" },
            { id: 102, projectid: 20, worktypeid: 7, worktype: "Old Worktype", active: "t" },
          ];
        }
        if (resource === "projectmodule") {
          return [
            { id: 200, projectid: 10, moduleid: 8, module: "Backend", active: "t" },
            { id: 201, projectid: 10, moduleid: 9, module: "Inactive Module", active: "f" },
            { id: 202, projectid: 20, moduleid: 10, module: "Old Module", active: "t" },
          ];
        }
        return [];
      },
    };

    const result = await syncProjectsCatalog(api, store);

    assert.equal(result.projects, 1);
    assert.equal(result.worktypes, 1);
    assert.equal(result.modules, 1);

    assert.equal(store.searchProjectContext({ query: "SFUP043" }).length, 1);
    assert.equal(store.searchProjectContext({ query: "Old Inactive" }).length, 0);

    const activeProject = store.searchProjectContext({ projectId: 10 })[0];
    assert.equal(activeProject.worktypes.length, 1);
    assert.equal(activeProject.worktypes[0].name, "Development");
    assert.equal(activeProject.modules.length, 1);
    assert.equal(activeProject.modules[0].name, "Backend");

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npx tsx --test tests/catalog-sync.test.ts
```

Expected: FAIL because inactive project/worktype/module rows are currently stored.

**Step 3: Implement active filtering in `src/catalog-sync.ts`**

Modify active normalization and filtering in `syncProjectsCatalog()`.

Add this helper near `normalizeBoolean()`:

```ts
function normalizeActive(val: unknown): boolean {
  // Intervals normally sends active as "t"/"f". If a fixture or future endpoint omits
  // the field, treat it as active rather than accidentally dropping the whole catalog.
  if (val == null) return true;
  return normalizeBoolean(val);
}
```

Change the mapped resource `active` fields from `normalizeBoolean(obj.active)` to `normalizeActive(obj.active)` for clients, projects, worktypes, and modules.

Then after mapping all four resource arrays, add filtering before `store.replaceCatalog()`:

```ts
  const activeProjects = projects.filter((p) => p.active);
  const activeProjectIds = new Set(activeProjects.map((p) => p.id));
  const referencedClientIds = new Set(
    activeProjects
      .map((p) => p.clientId)
      .filter((id): id is number => id != null),
  );

  const retainedClients = clients.filter((c) => c.active || referencedClientIds.has(c.id));
  const activeWorktypes = worktypes.filter((w) => w.active && activeProjectIds.has(w.projectId));
  const activeModules = modules.filter((m) => m.active && activeProjectIds.has(m.projectId));

  store.replaceCatalog({
    clients: retainedClients,
    projects: activeProjects,
    worktypes: activeWorktypes,
    modules: activeModules,
  });

  return {
    clients: retainedClients.length,
    projects: activeProjects.length,
    worktypes: activeWorktypes.length,
    modules: activeModules.length,
  };
```

Remove the previous unfiltered `store.replaceCatalog({ clients, projects, worktypes, modules })` and unfiltered count return.

**Step 4: Run test to verify it passes**

Run:

```bash
npx tsx --test tests/catalog-sync.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/catalog-sync.ts tests/catalog-sync.test.ts
git commit -m "fix(catalog): retain only active project catalog rows"
```

---

### Task 4: Add regression coverage that `/intervals-setup` syncs immediately

**Files:**
- Modify: `tests/commands.test.ts`
- Modify later only if tests reveal a gap: `src/commands.ts`

**Note:** Some setup sync behavior already exists. These tests are regression coverage for the user requirement. If they pass immediately, do not change production code for this task.

**Step 1: Strengthen env credential setup test**

Replace the body of `intervals-setup with env credentials shows env source` with:

```ts
test("intervals-setup with env credentials syncs project catalog immediately", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime({ credentialSource: "env" });
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-setup")!;
  const ctx = fakeCtx();

  await cmd.handler("", ctx);

  assert.equal(calls.syncProjectsCatalog, 1, "should sync project catalog immediately");
  const sourceNotify = ctx.notifications.find((n) => n.message.includes("environment"));
  assert.ok(sourceNotify, "should mention env source when credentials are configured");
  const syncNotify = ctx.notifications.find((n) => n.message.includes("Project sync complete"));
  assert.ok(syncNotify, "should show project sync success");
});
```

**Step 2: Add config credential setup test**

Append near the setup tests:

```ts
test("intervals-setup with config credentials syncs project catalog immediately", async () => {
  const { pi, commands } = fakePi();
  const { runtime, calls } = fakeRuntime({ credentialSource: "config" });
  registerIntervalsCommands(runtime, pi);
  const cmd = commands.find((c) => c.name === "intervals-setup")!;
  const ctx = fakeCtx();

  await cmd.handler("", ctx);

  assert.equal(calls.syncProjectsCatalog, 1, "should sync project catalog immediately");
  const sourceNotify = ctx.notifications.find((n) => n.message.includes("config file"));
  assert.ok(sourceNotify, "should mention config source when credentials are configured");
  const syncNotify = ctx.notifications.find((n) => n.message.includes("Project sync complete"));
  assert.ok(syncNotify, "should show project sync success");
});
```

The existing `intervals-setup interactive save reloads credentials and syncs` test already covers the interactive-save branch. Keep it.

**Step 3: Run focused tests**

Run:

```bash
npx tsx --test tests/commands.test.ts
```

Expected: PASS if existing behavior is intact. If either new test fails, fix `src/commands.ts` by ensuring every successful setup branch calls `runtime.syncProjectsCatalog()` before returning.

**Step 4: Optional cleanup only if editing `src/commands.ts`**

If command code needs changes or duplication becomes risky, extract this helper inside `registerIntervalsCommands()` before registering commands:

```ts
  async function syncCatalogAndNotify(ctx: ExtensionCommandContext): Promise<void> {
    try {
      const result = await runtime.syncProjectsCatalog();
      ctx.ui.notify(
        `Project sync complete: ${result.projects} projects, ${result.worktypes} worktypes, ${result.modules} modules, ${result.clients} clients`,
        "info",
      );
    } catch (err) {
      ctx.ui.notify(`Project sync failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }
```

Then replace duplicated setup/sync command `try/catch` blocks with:

```ts
await syncCatalogAndNotify(ctx);
```

**Step 5: Commit**

```bash
git add tests/commands.test.ts src/commands.ts
git commit -m "test(commands): cover setup catalog sync"
```

If `src/commands.ts` was not modified, commit only the test file.

---

### Task 5: Verify against the real local catalog

**Files:**
- No source changes expected.

**Step 1: Run full verification**

Run:

```bash
npm run check
```

Expected:

```text
pass 100%
fail 0
```

**Step 2: Reload the extension in pi**

In the active pi session, run:

```text
/reload
```

Expected: extension reloads without errors.

**Step 3: Re-sync projects**

In pi, run:

```text
/intervals-sync-projects
```

Expected: notification reports far more than 10 projects if the Intervals account has more active projects. It should report active project count only.

**Step 4: Check local catalog count**

Run this local inspection command:

```bash
node --input-type=module - <<'NODE'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/home/roche/.pi/intervals/intervals.db');
console.log('projects', db.prepare('select count(*) as count from projects').get().count);
console.log('inactive projects', db.prepare('select count(*) as count from projects where active = 0').get().count);
for (const row of db.prepare("select id, name from projects where name like '%SFUP043%' or name like '%Scaf%' order by name limit 20").all()) {
  console.log(`${row.id}: ${row.name}`);
}
db.close();
NODE
```

Expected:

- `projects` is greater than the current `10` if the account has more active projects.
- `inactive projects 0`.
- `SFUP043`/`Scaf` appears if it is an active project in Intervals.

**Step 5: Verify agent query behavior**

Ask pi:

```text
what project has code SFUP043?
```

Expected: pi uses `intervals_find_project_context` and returns the matching project plus worktypes/modules.

Then ask:

```text
what worktypes does Scaf have?
```

Expected: pi can answer from the local catalog without guessing.

---

### Task 6: Final commit after verification

If any verification-only fixes are needed, commit them:

```bash
git status --short
git add <changed-files>
git commit -m "fix(catalog): sync complete active Intervals catalog"
```

If Tasks 1-4 were committed separately and no further changes are present, skip this task.

## Risks and Notes

- The plan assumes Intervals supports `limit` and `offset` query parameters for collection endpoints. The observed 10-row default page strongly suggests this, but if real sync still returns 10 rows, inspect Intervals API docs or captured URLs and adjust pagination parameter names in `IntervalsApiClient`.
- If Intervals caps `limit` below 100, the loop still works as long as each full page returns the cap consistently and the final page is partial. If the API ignores `limit` but honors `offset`, this still works. If it ignores both, verification will expose that immediately.
- `normalizeActive(undefined) === true` is intentional to avoid dropping all records if an endpoint omits the active flag. Explicit false values (`false`, `0`, `"0"`, `"false"`, `"f"`) remain inactive.
- Keeping inactive projects out of the local catalog means existing local time entries for inactive projects may no longer display catalog names after a fresh catalog sync. This matches the requirement to sync active projects only.
