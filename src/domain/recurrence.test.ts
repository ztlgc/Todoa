import { expect, it } from "vitest";
import fixtures from "./__fixtures__/recurrence.json";
import { advanceRecurrenceRule, defaultRecurrence, isRecurrenceRule, nextRecurrenceDue, parseRecurrence, previewRecurrence, recurrenceLabel } from "./recurrence";
import { parseUpdateTaskInput } from "./task";

it.each(fixtures)("$name (shared with Rust)", ({ rule, prior, after, expected }) => {
  expect(isRecurrenceRule(rule)).toBe(true);
  const r = parseRecurrence(JSON.stringify(rule))!;
  expect(nextRecurrenceDue(new Date(prior).toISOString(), r, new Date(after))).toBe(expected ? new Date(expected).toISOString() : null);
});
it("validates persisted rules and decrements only the generated occurrence", () => {
  const r = { ...defaultRecurrence("2026-10-05"), end: "count" as const, count: 2 };
  const serialized=JSON.stringify(r);
  expect(parseUpdateTaskInput({repeatRule:serialized})).toEqual({repeatRule:serialized});
  expect(parseRecurrence(advanceRecurrenceRule(serialized))?.count).toBe(1);
  expect(parseRecurrence(serialized)?.count).toBe(2);
  expect(previewRecurrence(r)).toHaveLength(1);
});
it.each([{interval:0},{interval:1.5},{weekdays:[]},{weekdays:[0]},{monthDays:[32]},{dates:["2026-02-30"]},{end:"date",endDate:null},{end:"date",endDate:"2026-01-01"},{basis:"dates",dates:[]},{count:0},{v:2}])("rejects invalid advanced rule %j", patch => {
  expect(parseRecurrence(JSON.stringify({...defaultRecurrence("2026-10-05"),...patch}))).toBeNull();
});
it("summarizes the weekday selection without exposing storage JSON", () => {
  expect(recurrenceLabel({...defaultRecurrence("2026-10-05"),weekdays:[3,1]})).toContain("周一、周三");
});
