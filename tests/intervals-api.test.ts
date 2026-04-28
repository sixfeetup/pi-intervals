import assert from "node:assert/strict";
import test from "node:test";
import { IntervalsApiClient, sanitizeApiError, extractCollection } from "../src/intervals-api.js";

test("api client fetches resource collections with json headers", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ client: [{ id: 1, name: "Acme" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const api = new IntervalsApiClient({ apiKey: "secret", baseUrl: "https://api.example/", fetchImpl });
  const clients = await api.listResource("client");
  assert.deepEqual(clients, [{ id: 1, name: "Acme" }]);
  assert.equal(calls[0].url, "https://api.example/client/");
  assert.equal((calls[0].init.headers as Record<string, string>).Accept, "application/json");
  assert.ok((calls[0].init.headers as Record<string, string>).Authorization.startsWith("Basic "));
});

test("sanitizeApiError removes secrets", () => {
  assert.equal(sanitizeApiError("Authorization: Basic abc secret-key", "secret-key"), "Authorization: Basic [redacted] [redacted]");
});

test("createResource POSTs body with json content-type", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ time: { id: 42, projectid: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const api = new IntervalsApiClient({ apiKey: "secret", baseUrl: "https://api.example/", fetchImpl });
  const result = await api.createResource("time", { projectid: 10, time: 1 });
  assert.deepEqual(result, { time: { id: 42, projectid: 10 } });
  assert.equal(calls[0].url, "https://api.example/time/");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>)["Content-Type"], "application/json");
});

test("updateResource PUTs body with json content-type", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ time: { id: 42, projectid: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const api = new IntervalsApiClient({ apiKey: "secret", baseUrl: "https://api.example/", fetchImpl });
  const result = await api.updateResource("time", 42, { projectid: 10, time: 2 });
  assert.deepEqual(result, { time: { id: 42, projectid: 10 } });
  assert.equal(calls[0].url, "https://api.example/time/42/");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal((calls[0].init.headers as Record<string, string>)["Content-Type"], "application/json");
});

test("extractCollection detects various wrapper keys", () => {
  assert.deepEqual(extractCollection([1, 2], "time"), [1, 2]);
  assert.deepEqual(extractCollection({ time: [{ id: 1 }] }, "time"), [{ id: 1 }]);
  assert.deepEqual(extractCollection({ times: [{ id: 1 }] }, "time"), [{ id: 1 }]);
  assert.deepEqual(extractCollection({ items: [{ id: 1 }] }, "time"), [{ id: 1 }]);
  assert.deepEqual(extractCollection({ data: [{ id: 1 }] }, "time"), [{ id: 1 }]);
  assert.deepEqual(extractCollection({ other: [] }, "time"), []);
});
