import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { CatalogStore } from "../src/catalog-store.js";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "pi-intervals-catalog-"));
}

test("catalog store upserts and searches project context", () => {
  const dir = tmpDir();
  try {
    const db = openDatabase(join(dir, "intervals.db"));
    const store = new CatalogStore(db);
    store.replaceCatalog({
      clients: [{ id: 1, name: "Acme", active: true, raw: { id: 1, name: "Acme" } }],
      projects: [{ id: 10, clientId: 1, name: "Website", active: true, billable: true, raw: { id: 10 } }],
      worktypes: [{ id: 100, projectId: 10, worktypeId: 5, name: "Development", active: true, raw: { id: 100 } }],
      modules: [{ id: 200, projectId: 10, moduleId: 7, name: "Backend", active: true, raw: { id: 200 } }],
    });

    const matches = store.searchProjectContext({ query: "acme website" });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].projectName, "Website");
    assert.equal(matches[0].clientName, "Acme");
    assert.equal(matches[0].worktypes[0].name, "Development");
    assert.equal(matches[0].modules[0].name, "Backend");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getProject, getWorktype, getModule", () => {
  const dir = tmpDir();
  try {
    const db = openDatabase(join(dir, "intervals.db"));
    const store = new CatalogStore(db);
    store.replaceCatalog({
      clients: [{ id: 1, name: "Acme", active: true, raw: { id: 1 } }],
      projects: [{ id: 10, clientId: 1, name: "Website", active: true, billable: true, raw: { id: 10 } }],
      worktypes: [{ id: 100, projectId: 10, worktypeId: 5, name: "Development", active: true, raw: { id: 100 } }],
      modules: [{ id: 200, projectId: 10, moduleId: 7, name: "Backend", active: true, raw: { id: 200 } }],
    });

    const p = store.getProject(10);
    assert.equal(p?.name, "Website");

    const w = store.getWorktype(10, 5);
    assert.equal(w?.name, "Development");

    const m = store.getModule(10, 7);
    assert.equal(m?.name, "Backend");

    assert.equal(store.getProject(999), undefined);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("last project sync settings", () => {
  const dir = tmpDir();
  try {
    const db = openDatabase(join(dir, "intervals.db"));
    const store = new CatalogStore(db);
    assert.equal(store.getLastProjectSync(), undefined);
    store.setLastProjectSync("2026-04-24T12:00:00Z");
    assert.equal(store.getLastProjectSync(), "2026-04-24T12:00:00Z");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replaceCatalog overwrites previous data", () => {
  const dir = tmpDir();
  try {
    const db = openDatabase(join(dir, "intervals.db"));
    const store = new CatalogStore(db);
    store.replaceCatalog({
      clients: [{ id: 1, name: "Old", active: true, raw: { id: 1 } }],
      projects: [{ id: 10, clientId: 1, name: "Old", active: true, billable: true, raw: { id: 10 } }],
      worktypes: [],
      modules: [],
    });

    store.replaceCatalog({
      clients: [{ id: 2, name: "New", active: true, raw: { id: 2 } }],
      projects: [{ id: 20, clientId: 2, name: "New", active: true, billable: false, raw: { id: 20 } }],
      worktypes: [],
      modules: [],
    });

    assert.equal(store.getProject(10), undefined);
    assert.equal(store.getProject(20)?.name, "New");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
