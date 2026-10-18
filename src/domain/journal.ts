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
export const activityNames = { phone: "电话沟通", visit: "客户拜访", business: "业务推进", internal: "内部协调", other: "其他事项" } as const;
export const statusNames = { progress: "推进中", waiting_client: "待客户", waiting_internal: "待内部", completed: "已完成", revoked: "完成已撤销", unclassified: "未标注" } as const;
export type WorkStatus = keyof typeof statusNames;
export const bankingBusinesses = ["客户维护", "开户结算", "存款维护", "授信申报", "贷款投放", "续贷管理", "贷后管理", "票据业务", "国际业务", "综合服务"];
export const journalItemSchema = z.object({
  id: z.string().min(1).max(100), title: text(500).min(1), notes: text(20000),
  origin: z.literal("task_auto").optional(), revokedAt: z.string().datetime().nullable().optional(),
  taskId: z.number().int().positive().nullable(), completedAt: z.string().datetime().nullable(),
  taskCreatedAt: z.string().datetime().nullable().optional(),
  theme: text(100), important: z.boolean(),
  client: text(200).optional(), business: text(100).optional(),
  activity: z.enum(["phone", "visit", "business", "internal", "other"]).optional(),
  status: z.enum(["progress", "waiting_client", "waiting_internal", "completed", "unclassified"]).optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  nextAction: text(500).optional(), followUpAt: z.string().datetime().nullable().optional(),
  followUpTaskId: z.number().int().positive().nullable().optional(),
  followUpTaskCreatedAt: z.string().datetime().nullable().optional(),
});
export type JournalItem = z.infer<typeof journalItemSchema>;
const inputSchema = z.object({
  kind: z.enum(["day", "week", "month", "year"]), start: z.string(), end: z.string(),
  title: text(500), text: text(200000), theme: text(100), important: z.boolean(),
  items: z.array(journalItemSchema).max(1000),
});
export type JournalInput = z.infer<typeof inputSchema>;
export type JournalRecord = JournalInput & { revision: number; createdAt: string; updatedAt: string; deletedAt: string | null };
export function parseJournalDraft(value: unknown): JournalInput {
  const parsed = inputSchema.extend({ items: z.array(journalItemSchema.extend({ title: text(500) })).max(1000) }).parse(value);
  const period = journalPeriod(parsed.kind, parsed.start);
  if (period.end !== parsed.end || period.start !== parsed.start || (parsed.kind !== "day" && parsed.items.length)) throw new Error("草稿日期范围无效。");
  return parsed;
}
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
export function workStatus(item: JournalItem): WorkStatus { return item.origin === "task_auto" && item.revokedAt ? "revoked" : item.status ?? (item.completedAt ? "completed" : "unclassified"); }
export interface JournalFilters { query?: string; theme?: string; important?: boolean; client?: string; business?: string; status?: WorkStatus | ""; }
export function itemMatches(item: JournalItem, filters: JournalFilters, record?: JournalInput): boolean {
  const keyword = (filters.query ?? "").trim().toLocaleLowerCase();
  const content = [item.title, item.notes, item.theme, item.client, item.business, item.nextAction, item.activity && activityNames[item.activity]].join("\n").toLocaleLowerCase();
  return (!keyword || content.includes(keyword)) && (!filters.theme || item.theme === filters.theme || record?.theme === filters.theme)
    && (!filters.important || item.important || !!record?.important) && (!filters.client || item.client === filters.client)
    && (!filters.business || item.business === filters.business)
    && (!filters.status || workStatus(item) === filters.status);
}
// A filtered projection is only for browsing/export. Never save it over the full diary.
export function filterJournalRecords(records: JournalRecord[], filters: JournalFilters): JournalRecord[] {
  const active = !!(filters.query?.trim() || filters.theme || filters.important || filters.client || filters.business || filters.status);
  return records.filter(record => !record.deletedAt).flatMap(record => {
    if (!active) return [record];
    const items = record.items.filter(item => itemMatches(item, filters, record));
    if (items.length) return [{ ...record, items }];
    const keyword = (filters.query ?? "").trim().toLocaleLowerCase();
    const headerMatches = !filters.client && !filters.business && !filters.status && (!filters.theme || record.theme === filters.theme)
      && (!filters.important || record.important) && (!keyword || [record.title, record.text, record.theme].join("\n").toLocaleLowerCase().includes(keyword));
    return headerMatches ? [{ ...record, items: [] }] : [];
  });
}
export function journalMatches(record: JournalInput, query: string, theme: string, important: boolean): boolean {
  const keyword = query.trim().toLocaleLowerCase();
  const content = [record.title, record.text, record.theme, ...record.items.flatMap(item => [item.title, item.notes, item.theme, item.client, item.business, item.nextAction])].join("\n").toLocaleLowerCase();
  return (!keyword || content.includes(keyword)) && (!theme || record.theme === theme || record.items.some(item => item.theme === theme)) && (!important || isImportant(record));
}
export function summaryMaterials(records: JournalRecord[], kind: JournalKind, key: string): string {
  const period = journalPeriod(kind, key);
  const days = records.filter(record => !record.deletedAt && record.kind === "day" && record.start >= period.start && record.end <= period.end).sort((a, b) => a.start.localeCompare(b.start));
  const entries = days.flatMap(record => record.items.map(item => ({ date: record.start, item })));
  if (!days.length) return "";
  const sections: [string, typeof entries][] = [
    ["已完成事项", entries.filter(({ item }) => workStatus(item) === "completed")],
    ["在途业务", entries.filter(({ item }) => workStatus(item) === "progress")],
    ["等待与阻塞", entries.filter(({ item }) => ["waiting_client", "waiting_internal"].includes(workStatus(item)))],
    ["待核对的历史事项", entries.filter(({ item }) => workStatus(item) === "unclassified")],
    ["完成后撤销", entries.filter(({ item }) => workStatus(item) === "revoked")],
  ];
  const output = sections.filter(([, items]) => items.length).map(([heading, items]) => `### ${heading}\n${items.map(({ date, item }) => `- ${date} ${workItemMarkdown(item)}`).join("\n")}`);
  const next = entries.filter(({ item }) => item.nextAction);
  if (next.length) output.push(`### 下一步跟进\n${next.map(({ date, item }) => `- ${item.client || "未指定客户"}：${item.nextAction}${item.followUpAt ? `（${new Date(item.followUpAt).toLocaleString("zh-CN")}）` : ""}；来源 ${date}`).join("\n")}`);
  const notes = days.filter(record => record.text);
  if (notes.length) output.push(`### 每日补充\n${notes.map(record => `- ${record.start} ${record.title}\n${record.text}`).join("\n\n")}`);
  return output.join("\n\n");
}
export function workItemMarkdown(item: JournalItem): string {
  return `${item.important ? "★ " : ""}${item.client ? `${item.client} · ` : ""}${item.title} [${statusNames[workStatus(item)]}]${item.origin === "task_auto" ? ` · 自动记录 · 完成于 ${new Date(item.completedAt!).toLocaleString("zh-CN")}${item.revokedAt ? ` · 撤销于 ${new Date(item.revokedAt).toLocaleString("zh-CN")}` : ""}` : ""}${item.business || item.theme ? ` [${item.business || item.theme}]` : ""}${item.activity ? ` · ${activityNames[item.activity]}` : ""}${item.notes ? `\n  ${item.notes.split("\n").join("\n  ")}` : ""}${item.nextAction ? `\n  下一步：${item.nextAction}${item.followUpAt ? ` · ${new Date(item.followUpAt).toLocaleString("zh-CN")}` : ""}` : ""}`;
}
export function journalMarkdown(records: JournalRecord[], kind: JournalKind, key: string, query = "", theme = "", important = false, options: { allHistory?: boolean; client?: string; business?: string; status?: WorkStatus | "" } = {}): string {
  const period = journalPeriod(kind, key);
  const filtered = !!(query.trim() || theme || important || options.client || options.business || options.status);
  const entries = filterJournalRecords(records.filter(record => (!filtered || record.kind === "day") && (options.allHistory || (record.start >= period.start && record.end <= period.end && journalKinds.indexOf(record.kind) <= journalKinds.indexOf(kind)))), { query, theme, important, client: options.client, business: options.business, status: options.status });
  return `# 对公客户工作回顾 ${options.allHistory ? "全部历史" : `${period.start} — ${period.end}`}\n${options.client ? `\n客户：${options.client}\n` : ""}${theme ? `\n主题：${theme}\n` : ""}${entries.sort((a, b) => a.start.localeCompare(b.start) || a.kind.localeCompare(b.kind)).map(record => `\n## ${record.start} · ${{ day: "日记", week: "周总结", month: "月总结", year: "年度总结" }[record.kind]} ${record.title}\n${record.theme ? `\n主题：${record.theme}\n` : ""}\n${filtered && record.items.length ? "" : record.text}\n${record.items.map(item => `- ${workItemMarkdown(item)}`).join("\n")}\n`).join("\n")}`;
}
