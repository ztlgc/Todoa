import { z } from "zod";

export type JournalKind = "day" | "week" | "month" | "year";
export const journalKinds: JournalKind[] = ["day", "week", "month", "year"];
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseDateKey(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || Number(key.slice(0, 4)) < 1000 || dateKey(new Date(`${key}T12:00:00`)) !== key) throw new Error("请选择有效日期。");
  return key;
}
export function fromKey(key: string): Date { return new Date(`${parseDateKey(key)}T12:00:00`); }
export function journalPeriod(kind: JournalKind, key: string) {
  const start = fromKey(key), end = fromKey(key);
  if (kind === "week") { start.setDate(start.getDate() - (start.getDay() + 6) % 7); end.setTime(start.getTime()); end.setDate(start.getDate() + 6); }
  if (kind === "month") { start.setDate(1); end.setMonth(end.getMonth() + 1, 0); }
  if (kind === "year") { start.setMonth(0, 1); end.setMonth(11, 31); }
  return { kind, start: dateKey(start), end: dateKey(end) };
}
const text = (max: number) => z.string().max(max).refine(value => !value.includes("\0"), "文本不能包含空字符。");
export const journalItemSchema = z.object({
  id: z.string().min(1).max(100), title: text(500).min(1), notes: text(20000),
  taskId: z.number().int().positive().nullable(), completedAt: z.string().datetime().nullable(),
  taskCreatedAt: z.string().datetime().nullable().optional(),
  theme: text(100), important: z.boolean(),
});
export type JournalItem = z.infer<typeof journalItemSchema>;
const inputSchema = z.object({
  kind: z.enum(["day", "week", "month", "year"]), start: z.string(), end: z.string(),
  title: text(500), text: text(200000), theme: text(100), important: z.boolean(),
  items: z.array(journalItemSchema).max(1000),
});
export type JournalInput = z.infer<typeof inputSchema>;
export type JournalRecord = JournalInput & { revision: number; createdAt: string; updatedAt: string; deletedAt: string | null };
export function parseJournalInput(input: JournalInput): JournalInput {
  const parsed = inputSchema.parse(input);
  const period = journalPeriod(parsed.kind, parsed.start);
  if (period.start !== parsed.start || period.end !== parsed.end) throw new Error("记录时间范围无效。");
  if (new Set(parsed.items.map(item => item.id)).size !== parsed.items.length) throw new Error("工作条目重复。");
  if (parsed.kind !== "day" && parsed.items.length) throw new Error("阶段总结不能包含日记工作条目。");
  return parsed;
}
export function emptyJournal(kind: JournalKind, key: string): JournalInput {
  return { ...journalPeriod(kind, key), title: "", text: "", theme: "", important: false, items: [] };
}
export function isImportant(record: JournalInput): boolean { return record.important || record.items.some(item => item.important); }
export function journalMatches(record: JournalInput, query: string, theme: string, important: boolean): boolean {
  const keyword = query.trim().toLocaleLowerCase();
  const content = [record.title, record.text, record.theme, ...record.items.flatMap(item => [item.title, item.notes, item.theme])].join("\n").toLocaleLowerCase();
  return (!keyword || content.includes(keyword)) && (!theme || record.theme === theme || record.items.some(item => item.theme === theme)) && (!important || isImportant(record));
}
export function summaryMaterials(records: JournalRecord[], kind: JournalKind, key: string): string {
  const period = journalPeriod(kind, key);
  const children = records.filter(record => !record.deletedAt && record.start >= period.start && record.end <= period.end && record.kind !== kind && (kind === "week" ? record.kind === "day" : kind === "month" ? record.kind === "day" || record.kind === "week" : true));
  return children.sort((a, b) => a.start.localeCompare(b.start)).map(record => `### ${record.start}${record.kind !== "day" ? ` — ${record.end}` : ""} ${record.title}\n${record.text}\n${record.items.map(item => `- ${item.important ? "★ " : ""}${item.title}${item.theme ? ` [${item.theme}]` : ""}${item.notes ? `：${item.notes}` : ""}`).join("\n")}`).join("\n\n");
}
export function journalMarkdown(records: JournalRecord[], kind: JournalKind, key: string, query = "", theme = "", important = false): string {
  const period = journalPeriod(kind, key);
  const entries = records.filter(record => !record.deletedAt && record.start >= period.start && record.end <= period.end && journalKinds.indexOf(record.kind) <= journalKinds.indexOf(kind) && journalMatches(record, query, theme, important));
  return `# 工作回顾 ${period.start} — ${period.end}\n${theme ? `\n主题：${theme}\n` : ""}${entries.sort((a, b) => a.start.localeCompare(b.start) || a.kind.localeCompare(b.kind)).map(record => `\n## ${record.start} · ${{ day: "日记", week: "周总结", month: "月总结", year: "年度总结" }[record.kind]} ${record.title}\n${record.theme ? `\n主题：${record.theme}\n` : ""}\n${record.text}\n${record.items.map(item => `- ${item.important ? "★ " : ""}${item.title}${item.theme ? ` [${item.theme}]` : ""}${item.notes ? `\n  ${item.notes.split("\n").join("\n  ")}` : ""}`).join("\n")}\n`).join("\n")}`;
}
