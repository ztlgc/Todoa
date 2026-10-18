import { z } from "zod";
import { dateKey, emptyJournal, journalItemSchema, parseDateKey, type JournalItem, type JournalRecord } from "./journal";
import type { Task } from "./task";

const dateSchema = z.string().refine(value => { try { return parseDateKey(value) === value; } catch { return false; } });
// Task limits count Unicode characters. Preserve every valid task snapshot,
// including long notes and supplementary characters, without truncation.
const snapshotText = (max: number) => z.string().refine(value => !value.includes("\0") && (value.length <= max || [...value].length <= max), "任务快照文本无效。");
const completionSchema = z.object({
  day: dateSchema, revokedDay: dateSchema.nullable(),
  item: journalItemSchema.extend({ origin: z.literal("task_auto"), status: z.literal("completed"), title:snapshotText(500).min(1), notes:snapshotText(100000), theme:snapshotText(100), taskId: z.number().int().positive(), taskCreatedAt: z.string().datetime(), completedAt: z.string().datetime() }),
}).refine(value => (value.revokedDay === null) === !value.item.revokedAt, "自动完成记录的撤销信息不完整。");
export type JournalCompletion = z.infer<typeof completionSchema>;
export const parseJournalCompletion = (value: unknown): JournalCompletion => completionSchema.parse(value);
export function completionSnapshot(task: Task, theme: string): JournalCompletion {
  if (task.status !== "completed" || !task.completedAt) throw new Error("任务尚未完成。");
  return parseJournalCompletion({ day: dateKey(new Date(task.completedAt)), revokedDay: null, item: {
    id: `auto:${task.id}:${task.createdAt}:${task.completedAt}`, origin: "task_auto",
    title: task.title, notes: task.notes, theme, important: task.priority === "high",
    taskId: task.id, taskCreatedAt: task.createdAt, completedAt: task.completedAt,
    occurredAt: task.completedAt, status: "completed", revokedAt: null,
  } });
}
export function sameCompletion(a: JournalItem, b: JournalItem): boolean {
  return a.taskId !== null && a.taskId === b.taskId && !!a.completedAt && a.completedAt === b.completedAt
    && (!a.taskCreatedAt || !b.taskCreatedAt || a.taskCreatedAt === b.taskCreatedAt);
}
export function handwrittenJournal<T extends { items: JournalItem[] }>(record: T): T {
  return { ...record, items: record.items.filter(item => item.origin !== "task_auto") };
}

// Automatic days are persisted as completion rows, so no handwritten revision is
// consumed until the first manual save. Deletion creates an ordinary tombstone.
export function mergeJournalCompletions(records: JournalRecord[], completions: JournalCompletion[]): JournalRecord[] {
  const result = records.map(record => ({ ...record, items: [...record.items] }));
  const days = new Map(result.filter(record => record.kind === "day").map(record => [record.start, record]));
  for (const completion of [...completions].sort((a, b) => a.item.completedAt.localeCompare(b.item.completedAt) || a.item.id.localeCompare(b.item.id))) {
    if (completion.revokedDay === completion.day) continue;
    const { day, item } = completion;
    let record = days.get(day);
    if (!record) {
      record = { ...emptyJournal("day", day), revision: 0, createdAt: item.completedAt, updatedAt: item.revokedAt ?? item.completedAt, deletedAt: null };
      days.set(day, record); result.push(record);
    }
    if (!record.items.some(entry => entry.id === item.id || sameCompletion(entry, item))) record.items.push(item);
    if ((item.revokedAt ?? item.completedAt) > record.updatedAt) record.updatedAt = item.revokedAt ?? item.completedAt;
  }
  return result.sort((a, b) => b.start.localeCompare(a.start) || a.kind.localeCompare(b.kind));
}
