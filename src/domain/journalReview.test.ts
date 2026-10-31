import { expect, it } from "vitest";
import { parseHighlightInput } from "./journalReview";
const input = { id: " uuid ", date: "2026-10-31", summary: " 重点 ", result: "", theme: "", sourceType: "note" as const, sourceId: " uuid ", sourceRevision: 0 };
it("returns only native input fields even when called with a full highlight", () => {
  expect(parseHighlightInput({ ...input, revision: 3, sourceChanged: true } as typeof input)).toEqual({ ...input, id: "uuid", summary: "重点", sourceId: "uuid" });
});
it("validates trimmed UTF16 length, dates and source revisions", () => {
  expect(() => parseHighlightInput({ ...input, summary: " \n " })).toThrow();
  expect(() => parseHighlightInput({ ...input, summary: "😀".repeat(10001) })).toThrow();
  expect(() => parseHighlightInput({ ...input, date: "2026-02-30" })).toThrow();
  expect(() => parseHighlightInput({ ...input, sourceType: "task", sourceRevision: 1 })).toThrow();
  expect(() => parseHighlightInput({ ...input, result: "a\0b" })).toThrow();
});
