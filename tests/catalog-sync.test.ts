import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syncProjectsCatalog } from "../src/catalog-sync.js";
import { CatalogStore } from "../src/catalog-store.js";
import { openDatabase } from "../src/db.js";

test("syncProjectsCatalog fetches all reference resources", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-intervals-sync-"));
  try {
    const db = openDatabase(join(dir, "intervals.db"));
    const store = new CatalogStore(db);
    const resources: string[] = [];
    const api = {
      listResource: async (resource: string) => {
        resources.push(resource);
        if (resource === "client") return [{ id: 1, name: "Acme", active: "t" }];
        if (resource === "project") return [{ id: 10, clientid: 1, name: "Website", active: "t", billable: "t" }];
        if (resource === "projectworktype") return [{ id: 100, projectid: 10, worktypeid: 5, worktype: "Development", active: "t" }];
        if (resource === "projectmodule") return [{ id: 200, projectid: 10, moduleid: 7, module: "Backend", active: "t" }];
        return [];
      },
    };
    const result = await syncProjectsCatalog(api, store);
    assert.deepEqual(resources, ["client", "project", "projectworktype", "projectmodule"]);
    assert.equal(result.projects, 1);
    assert.equal(store.searchProjectContext({ query: "website" })[0].modules[0].name, "Backend");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
