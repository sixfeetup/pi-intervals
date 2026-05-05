import assert from "node:assert/strict";
import test from "node:test";
import { formatLocalTimeOfDay, formatTimeEntryWindow } from "../src/time-window.js";

test("formatLocalTimeOfDay renders ISO timestamps as local HH:mm", () => {
  const text = formatLocalTimeOfDay("2026-05-05T07:07:43.897Z", "en-GB");
  assert.match(text, /^\d{2}:\d{2}$/);
});

test("formatLocalTimeOfDay normalizes valid bare H:mm values", () => {
  assert.equal(formatLocalTimeOfDay("7:05", "en-GB"), "07:05");
  assert.equal(formatLocalTimeOfDay("08:35", "en-GB"), "08:35");
});

test("formatLocalTimeOfDay preserves invalid bare-time-shaped values", () => {
  assert.equal(formatLocalTimeOfDay("7:99", "en-GB"), "7:99");
  assert.equal(formatLocalTimeOfDay("25:00", "en-GB"), "25:00");
});

test("formatLocalTimeOfDay preserves invalid non-date strings", () => {
  assert.equal(formatLocalTimeOfDay("not-a-date", "en-GB"), "not-a-date");
});

test("formatTimeEntryWindow renders start and end when both are present", () => {
  const text = formatTimeEntryWindow({ startAt: "07:07", endAt: "08:35" });
  assert.equal(text, "07:07-08:35");
});

test("formatTimeEntryWindow renders empty string when start or end is missing", () => {
  assert.equal(formatTimeEntryWindow({ startAt: "07:07" }), "");
  assert.equal(formatTimeEntryWindow({ endAt: "08:35" }), "");
});
