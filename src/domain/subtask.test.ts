import { expect, it } from "vitest";
import { readSubtasks, withSubtasks } from "./subtask";

it("preserves rich body content and reads ordered, independently completed subtasks", () => {
  const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文", marks: [{ type: "bold" }] }] }] };
  const items = [{ id: "one", title: "确认需求", completed: false, dueDate: "2026-10-20" }, { id: "two", title: "交付材料", completed: true, dueAt: "2026-10-21T01:30:00.000Z" }];
  const doc = withSubtasks(body, items);
  expect(readSubtasks(doc)).toEqual(items);
  expect(doc.content).toEqual(body.content);
  expect(withSubtasks(doc, [])).toEqual(body);
});

it("rejects duplicate identities and malformed subtasks before saving", () => {
  const item = { id: "one", title: "检查", completed: false };
  expect(() => readSubtasks({ type: "doc", attrs: { subtasks: [item, item] } })).toThrow();
  for (const bad of [{ ...item, title: " " }, { ...item, completed: "false" }, { ...item, title: "x".repeat(501) }, { ...item, dueDate: "2026-02-30" }, { ...item, dueAt: "2026-10-20 9:30" }, { ...item, dueDate: "2026-10-20", dueAt: "2026-10-20T01:30:00.000Z" }]) {
    expect(() => readSubtasks({ type: "doc", attrs: { subtasks: [bad] } })).toThrow();
  }
});
