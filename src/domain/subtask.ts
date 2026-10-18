import type { JSONContent } from "@tiptap/react";
import { parseTaskTime, parseTaskTitle } from "./task";

export type SubtaskSchedule = { dueDate?: string; dueAt?: string };
export type Subtask = { id: string; title: string; completed: boolean } & SubtaskSchedule;
export function readSubtasks(doc: JSONContent): Subtask[] {
  const raw: unknown = doc.attrs?.subtasks;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 500) throw new Error("子任务数量不能超过500项。");
  const ids = new Set<string>();
  return raw.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("子任务格式无效。");
    const item = value as Partial<Subtask>;
    if (typeof item.id !== "string" || !item.id || item.id.length > 100 || item.id.includes("\0") || ids.has(item.id) || typeof item.completed !== "boolean") throw new Error("子任务格式无效。");
    ids.add(item.id);
    const schedule: SubtaskSchedule = {};
    if (item.dueDate !== undefined) {
      if (typeof item.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) || item.dueDate.startsWith("0000") || new Date(`${item.dueDate}T12:00:00Z`).toISOString().slice(0, 10) !== item.dueDate) throw new Error("子任务日期无效。");
      schedule.dueDate = item.dueDate;
    }
    if (item.dueAt !== undefined) schedule.dueAt = parseTaskTime(item.dueAt);
    if (schedule.dueDate && schedule.dueAt) throw new Error("子任务日期和时间不能重复设置。");
    return { id: item.id, title: parseTaskTitle(item.title), completed: item.completed, ...schedule };
  });
}

// The body editor may omit document attributes. Merge the checklist back before
// saving so a normal rich-text edit can never silently discard subtasks.
export function withSubtasks(doc: JSONContent, items: Subtask[]): JSONContent {
  const attrs = { ...doc.attrs };
  if (items.length) attrs.subtasks = items;
  else delete attrs.subtasks;
  const result = { ...doc, ...(Object.keys(attrs).length ? { attrs } : {}) };
  if (!Object.keys(attrs).length) delete result.attrs;
  readSubtasks(result);
  return result;
}

export function subtaskText(doc: JSONContent): string {
  return readSubtasks(doc).map(item => `[${item.completed ? "x" : " "}] ${item.title}`).join("\n");
}
