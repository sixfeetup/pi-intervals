import assert from "node:assert/strict";
import test from "node:test";
import { calculateDurationForLocalStopTime, formatLocalTimeOfDay, formatTimeEntryWindow } from "../src/time-window.js";

function localIso(year: number, monthIndex: number, day: number, hour: number, minute: number, second = 0, millisecond = 0): string {
  return new Date(year, monthIndex, day, hour, minute, second, millisecond).toISOString();
}

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

test("calculateDurationForLocalStopTime calculates duration from local HH:mm stop time", () => {
  const startAt = localIso(2026, 4, 5, 7, 7, 43, 897);
  const result = calculateDurationForLocalStopTime({
    date: "2026-05-05",
    startAt,
    stopTime: "08:35",
  });
  const expectedRawDurationSeconds = Math.floor(
    (new Date(2026, 4, 5, 8, 35, 0, 0).getTime() - new Date(startAt).getTime()) / 1000,
  );

  assert.equal(result.endAt, "08:35");
  assert.equal(result.durationSeconds, 5240);
  assert.equal(result.rawDurationSeconds, 5236);
  assert.equal(result.rawDurationSeconds, expectedRawDurationSeconds);
  assert.notEqual(result.rawDurationSeconds, result.durationSeconds);
});

test("calculateDurationForLocalStopTime rejects stop times before local start time", () => {
  assert.throws(
    () => calculateDurationForLocalStopTime({
      date: "2026-05-05",
      startAt: localIso(2026, 4, 5, 7, 7, 43, 897),
      stopTime: "06:35",
    }),
    /before start time/,
  );
});

test("calculateDurationForLocalStopTime rejects stop times a few seconds before local start time", () => {
  const startAt = new Date(2026, 4, 5, 8, 35, 4, 0).toISOString();

  assert.throws(
    () => calculateDurationForLocalStopTime({
      date: "2026-05-05",
      startAt,
      stopTime: "08:35",
    }),
    /before start time/,
  );
});

test("calculateDurationForLocalStopTime rejects invalid dates", () => {
  assert.throws(
    () => calculateDurationForLocalStopTime({
      date: "2026-02-31",
      startAt: new Date(2026, 1, 1, 8, 0, 0, 0).toISOString(),
      stopTime: "08:35",
    }),
    /invalid date/,
  );

  assert.throws(
    () => calculateDurationForLocalStopTime({
      date: "2026-13-01",
      startAt: new Date(2026, 11, 1, 8, 0, 0, 0).toISOString(),
      stopTime: "08:35",
    }),
    /invalid date/,
  );
});
