import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getIntervalsHome, loadConfig, resolveCredentials } from "../src/config.js";

test("getIntervalsHome uses PI_INTERVALS_HOME when present", () => {
  const home = getIntervalsHome({ PI_INTERVALS_HOME: "/tmp/pi-intervals-test" });
  assert.equal(home, "/tmp/pi-intervals-test");
});

test("getIntervalsHome defaults to ~/.pi/intervals", () => {
  assert.equal(getIntervalsHome({}), join(homedir(), ".pi", "intervals"));
});

test("getIntervalsHome stores data in the selected Pi agent directory", () => {
  assert.equal(getIntervalsHome({ PI_CODING_AGENT_DIR: "/srv/pi-agent" }), "/srv/pi-agent/intervals");
});

test("getIntervalsHome expands a tilde in the Pi agent directory as Pi does", () => {
  assert.equal(getIntervalsHome({ PI_CODING_AGENT_DIR: "~/agent" }), join(homedir(), "agent", "intervals"));
  assert.equal(getIntervalsHome({ PI_CODING_AGENT_DIR: "~" }), join(homedir(), "intervals"));
});

test("getIntervalsHome prefers PI_INTERVALS_HOME over the Pi agent directory", () => {
  const home = getIntervalsHome({ PI_INTERVALS_HOME: "/tmp/pi-intervals-test", PI_CODING_AGENT_DIR: "/srv/pi-agent" });
  assert.equal(home, "/tmp/pi-intervals-test");
});

test("resolveCredentials prefers environment variables over config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-intervals-"));
  try {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ apiKey: "file-key", baseUrl: "https://file.example/" }));
    const config = loadConfig(dir);
    const creds = resolveCredentials(config, { INTERVALS_API_KEY: "env-key", INTERVALS_BASE_URL: "https://env.example/" });
    assert.deepEqual(creds, { apiKey: "env-key", baseUrl: "https://env.example/", source: "env" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
