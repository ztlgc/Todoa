import { describe, expect, it } from "vitest";
import { nextRepeatDue, parseNaturalTaskInput } from "./naturalTaskInput";
import { editRecurrence } from "./recurrence";
import { parseCreateTaskInput, parseUpdateTaskInput } from "./task";
import legacyFixtures from "./__fixtures__/legacyRecurrence.json";

describe("schedule audit regressions", () => {
  it.each(legacyFixtures)("matches desktop legacy calendar rules: $rule / $prior", ({ rule, prior, after, expected }) => {
    expect(nextRepeatDue(new Date(prior).toISOString(), rule, new Date(after))).toBe(expected ? new Date(expected).toISOString() : null);
  });
  it.each([
    ["2026-11-17T09:00:00", "下周一开会", "2026-11-23"],
    ["2026-11-22T09:00:00", "下周一开会", "2026-11-23"],
    ["2026-11-22T09:00:00", "本周日开会", "2026-11-22"],
    ["2026-11-16T09:00:00", "大后天开会", "2026-11-19"],
  ])("uses calendar weeks for %s / %s", (now, input, expected) => {
    const parsed = parseNaturalTaskInput(input, new Date(now));
    const due = new Date(parsed.dueAt!);
    expect(`${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`).toBe(expected);
    expect(parsed.title).toBe("开会");
  });

  it.each([
    "明天下午25点开会",
    "明天24:30开会",
    "明天13pm开会",
    "2026-02-30下午3点开会",
    "2026-13-01 09:30开会",
    "每0天开会",
    "每年2月30日开会",
    "每月第32天开会",
    "2026-11-160开会",
    "明天123:45开会",
    "123:45开会",
    "明天09:30:45开会",
    "2026-11-17T09:30:00开会",
    "每周一至周五开会",
  ])("keeps invalid schedule text intact: %s", input => {
    const parsed = parseNaturalTaskInput(input, new Date(2026, 10, 16, 9));
    expect(parsed).toMatchObject({ title: input, dueAt: null, repeatRule: null, reminderOffsets: [] });
  });

  it.each([
    ["每周一09:30整理资料", "2026-11-23", 9, 30],
    ["每周三18:00整理资料", "2026-11-18", 18, 0],
    ["每月最后一天整理资料", "2026-11-30", 12, 0],
    ["每周18:00整理资料", "2026-11-23", 18, 0],
  ])("starts recurring input on its requested calendar day: %s", (input, expected, hour, minute) => {
    const parsed = parseNaturalTaskInput(input, new Date(2026, 10, 17, 10));
    const due = new Date(parsed.dueAt!);
    expect(`${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`).toBe(expected);
    expect([due.getHours(), due.getMinutes()]).toEqual([hour, minute]);
    expect(parsed.title).toBe("整理资料");
    expect(() => parseCreateTaskInput(parsed)).not.toThrow();
  });

  it("advances an annual fixed date within the same year and preserves precision", () => {
    const prior = new Date(2026, 0, 1, 9, 30, 15, 456);
    expect(nextRepeatDue(prior.toISOString(), "year-date:3:6", prior)).toBe(new Date(2026, 2, 6, 9, 30, 15, 456).toISOString());
  });

  it("catches up legacy daily schedules older than 10000 days", () => {
    const prior = new Date(1990, 0, 1, 9);
    const after = new Date(2026, 10, 16, 10);
    expect(nextRepeatDue(prior.toISOString(), "day:1", after)).toBe(new Date(2026, 10, 17, 9).toISOString());
  });

  it.each(["year-date:2:30", "year-date:4:31", "year-date:2:31"])("rejects impossible annual dates: %s", repeatRule => {
    expect(() => parseCreateTaskInput({ title: "任务", dueAt: "2026-11-17T01:00:00.000Z", repeatRule })).toThrow();
  });

  it.each(["0000-01-01", "2026-02-30", "9999-13-01"])("rejects invalid all-day dates with a validation error: %s", dueDate => {
    expect(() => parseUpdateTaskInput({ dueDate })).toThrowError(expect.objectContaining({ name: "TaskValidationError" }));
  });

  it("retains daily frequency when editing legacy weekday and weekend rules", () => {
    expect(editRecurrence("weekday", "2026-11-16")).toMatchObject({ frequency: "week", weekdays: [1, 2, 3, 4, 5] });
    expect(editRecurrence("weekend", "2026-11-16")).toMatchObject({ frequency: "week", weekdays: [6, 7] });
  });

  it("recognizes multiple weekly weekdays without extracting a conflicting date", () => {
    const parsed = parseNaturalTaskInput("每周一、周三09:30整理资料", new Date(2026, 10, 17, 10));
    expect(parsed.title).toBe("整理资料");
    expect(JSON.parse(parsed.repeatRule!).weekdays).toEqual([1, 3]);
    expect(new Date(parsed.dueAt!).getDay()).toBe(3);
  });
});
