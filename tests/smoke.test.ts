import assert from "node:assert/strict";
import test from "node:test";
import extension from "../src/index.js";

test("extension exports a default function", () => {
  assert.equal(typeof extension, "function");
});
