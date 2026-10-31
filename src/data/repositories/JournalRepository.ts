import { isBrowserDebug } from "@/app/browserDebug";
import { invoke } from "@tauri-apps/api/core";
import { initDatabase } from "@/data/db/initDatabase";
import type { SqlDatabase } from "@/data/db/SqlDatabase";
import { dateKey, emptyJournal, journalKinds, parseDateKey, parseJournalInput, type JournalInput, type JournalKind, type JournalRecord } from "@/domain/journal";
import { completionSnapshot, handwrittenJournal, mergeJournalCompletions, parseJournalCompletion, type JournalCompletion } from "@/domain/journalAutomation";
import type { Task, TaskStatus } from "@/domain/task";
import type { TaskList } from "@/domain/list";
import type { JSONContent } from "@tiptap/react";
import { parseJournalDocument } from "@/domain/journalContent";
import { readBrowserJournalImage } from "@/data/browserJournalImages";
import { parseHighlightInput, type JournalHighlight } from "@/domain/journalReview";

export const JOURNAL_STORAGE_KEY = "todoa.journal.v1";
export const WORK_JOURNAL_TEST_STORAGE_KEY = "todoa.journal.real-work-test.v1";
export const BANK_JOURNAL_TEST_STORAGE_KEY = "todoa.journal.bank-test.v1";
export class JournalConflictError extends Error {
  constructor() { super("这份记录已在其他窗口更新，请重新打开后编辑。当前输入已保留。"); this.name = "JournalConflictError"; }
}
const conflict = () => new JournalConflictError();
type Row = { kind: string; period_start: string; period_end: string; title: string; body: string; theme: string; important: number; items_json: string; revision: number; created_at: string; updated_at: string; deleted_at: string | null; content_json?: string | null; content_revision?: number };
type CompletionRow = { id: string; day: string; task_id: number; task_created_at: string; completed_at: string; title: string; notes: string; theme: string; important: number; revoked_at: string | null; revoked_day: string | null };
function mapCompletion(row: CompletionRow): JournalCompletion {
  return parseJournalCompletion({ day: row.day, revokedDay: row.revoked_day, item: {
    id: row.id, origin: "task_auto", title: row.title, notes: row.notes, theme: row.theme, important: row.important === 1,
    taskId: row.task_id, taskCreatedAt: row.task_created_at, completedAt: row.completed_at,
    occurredAt: row.completed_at, status: "completed", revokedAt: row.revoked_at,
  } });
}
function mapRow(row: Row): JournalRecord {
  if (row.content_json) parseJournalDocument(row.content_json);
  const input = parseJournalInput({ kind: row.kind as JournalInput["kind"], start: row.period_start, end: row.period_end, title: row.title, text: row.body, theme: row.theme, important: row.important === 1, items: JSON.parse(row.items_json) });
  return { ...input, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, contentJson: row.content_json, contentRevision: row.content_revision ?? 0 };
}
export type JournalIndexEntry = { kind: JournalKind; start: string; deletedAt: string | null; hasContent: boolean; completionCount: number };
export type JournalSearchOptions = { query: string; from?: string; to?: string; offset?: number; limit?: number; trash?: boolean };
type JournalKey = { kind: JournalKind; start: string };
function checkRange(from: string, to: string) {
  parseDateKey(from); parseDateKey(to);
  if (from > to) throw new Error("日记日期范围无效。");
}
function checkKind(kind: JournalKind) {
  if (!journalKinds.includes(kind)) throw new Error("日记类型无效。");
}
const recordOrder = (a: JournalKey, b: JournalKey) => b.start.localeCompare(a.start) || a.kind.localeCompare(b.kind);
// SQLite LIKE folds ASCII case; Chinese and other uncased text compare literally.
// Use the same folding in browser storage rather than promising Unicode case folding.
const searchFold = (value: string) => value.replace(/[A-Z]/g, char => char.toLowerCase());
const searchableItem = (item: JournalInput["items"][number]) => [item.title, item.notes, item.theme, item.client, item.business, item.nextAction];
function matchesSearch(record: JournalRecord, query: string, highlights: JournalHighlight[] = []) {
  return [record.title, record.text, ...record.items.flatMap(searchableItem), ...highlights.flatMap(item => [item.summary, item.result, item.theme])]
    .some(value => searchFold(value ?? "").includes(query));
}
function completionCount(record: JournalRecord) {
  return record.items.filter(item => item.origin === "task_auto" || (!!item.taskId && !!item.completedAt && dateKey(new Date(item.completedAt)) === record.start)).length;
}
// Both metadata and search operate on bounded rows. Only legacy items are inspected
// with JSON1; rich document JSON is never parsed for metadata or keyword selection.
function querySources(search = false) {
  return `WITH scoped_records AS (
    SELECT kind,period_start,deleted_at,
      (length(trim(title))>0 OR length(trim(body))>0 OR json_array_length(items_json)>0 OR content_json IS NOT NULL) AS has_content${search ? ",title,body" : ""}
    FROM journal_records WHERE period_start>=?1 AND period_start<=?2
  ), legacy_items AS (
    SELECT r.kind,r.period_start,j.value AS item
    FROM journal_records r,json_each(r.items_json) j
    WHERE r.period_start>=?1 AND r.period_start<=?2
  ), visible_completions AS (
    SELECT c.* FROM journal_task_completions c
    WHERE c.day>=?1 AND c.day<=?2 AND (c.revoked_day IS NULL OR c.revoked_day<>c.day)
      AND NOT EXISTS (SELECT 1 FROM legacy_items l WHERE l.kind='day' AND l.period_start=c.day AND (
        json_extract(l.item,'$.id')=c.id OR (
          json_extract(l.item,'$.taskId')=c.task_id AND json_extract(l.item,'$.completedAt')=c.completed_at
          AND (json_extract(l.item,'$.taskCreatedAt') IS NULL OR json_extract(l.item,'$.taskCreatedAt')='' OR json_extract(l.item,'$.taskCreatedAt')=c.task_created_at)
        )
      ))
  ), available_highlights AS (
    SELECT h.* FROM journal_highlights h WHERE h.date>=?1 AND h.date<=?2 AND h.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM scoped_records r WHERE r.kind='day' AND r.period_start=h.date AND r.deleted_at IS NOT NULL)
      AND (h.source_type<>'task' OR EXISTS (
        SELECT 1 FROM journal_task_completions c WHERE c.day=h.date AND c.id=h.source_id AND c.revoked_at IS NULL
      ))
      AND (h.source_type<>'legacy' OR EXISTS (
        SELECT 1 FROM legacy_items l WHERE l.kind='day' AND l.period_start=h.date AND json_extract(l.item,'$.id')=h.source_id
          AND coalesce(json_extract(l.item,'$.origin'),'')<>'task_auto'
      ))
  ), highlight_days AS (
    SELECT DISTINCT date AS day FROM available_highlights WHERE source_type<>'task'
  ), journal_keys AS (
    SELECT kind,period_start FROM scoped_records
    UNION SELECT 'day',day FROM visible_completions
    UNION SELECT 'day',day FROM highlight_days
  )`;
}
export class JournalRepository {
  constructor(private database: () => Promise<SqlDatabase> = initDatabase, private browser = isBrowserDebug, private storage: () => Storage = () => localStorage, private storageKey = JOURNAL_STORAGE_KEY) {}
  get draftNamespace() { return this.browser() ? this.storageKey : "desktop"; }
  private readCompletions(): JournalCompletion[] {
    const raw = this.storage().getItem(`${this.storageKey}.task-completions.v1`);
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) throw new Error("自动日记存储格式无效。");
    return values.map(parseJournalCompletion);
  }
  private writeCompletions(values: JournalCompletion[]) {
    this.storage().setItem(`${this.storageKey}.task-completions.v1`, JSON.stringify(values));
  }
  recordBrowserTaskStatus(task: Task, status: TaskStatus, now: string, theme = ""): void {
    if (!this.browser()) throw new Error("自动日记应通过桌面任务事务保存。");
    if (task.status === status) return;
    const completions = this.readCompletions();
    if (status === "completed") {
      const snapshot = completionSnapshot({ ...task, status, completedAt: now }, theme);
      const existing = completions.find(value => value.item.id === snapshot.item.id);
      if (existing) { existing.revokedDay = null; existing.item.revokedAt = null; }
      else completions.push(snapshot);
    } else {
      if (task.completedAt) {
        const snapshot = completionSnapshot(task, theme);
        if (!completions.some(value => value.item.id === snapshot.item.id)) completions.push(snapshot);
      }
      for (const completion of completions) {
        if (completion.item.taskId === task.id && completion.item.taskCreatedAt === task.createdAt && !completion.item.revokedAt) {
          completion.item.revokedAt = now; completion.revokedDay = dateKey(new Date(now));
        }
      }
    }
    this.writeCompletions(completions);
  }
  async reconcile(tasks: Task[] = [], lists: TaskList[] = []): Promise<void> {
    if (!this.browser()) { await invoke("reconcile_journal_tasks"); return; }
    const completions = this.readCompletions();
    let changed = false;
    for (const task of tasks) {
      if (task.status !== "completed" || !task.completedAt) continue;
      const snapshot = completionSnapshot(task, lists.find(list => list.id === task.listId)?.name ?? "");
      if (!completions.some(value => value.item.id === snapshot.item.id)) { completions.push(snapshot); changed = true; }
    }
    if (changed) this.writeCompletions(completions);
  }
  private readHighlights(): JournalHighlight[] {
    const raw = this.storage().getItem(`${this.storageKey}.review.v1`);
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) throw new Error("重点存储格式无效。");
    return values.map((value: JournalHighlight) => {
      parseHighlightInput(value);
      if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error("重点版本无效。");
      return value;
    });
  }
  private availableHighlights(records: JournalRecord[], completions: JournalCompletion[]): JournalHighlight[] {
    return this.readHighlights().filter(item => {
      if (item.deletedAt) return false;
      const day = records.find(record => record.kind === "day" && record.start === item.date);
      if (day?.deletedAt) return false;
      if (item.sourceType === "task") return completions.some(value => value.day === item.date && value.item.id === item.sourceId && !value.item.revokedAt);
      if (item.sourceType === "legacy") return !!day?.items.some(value => value.id === item.sourceId && value.origin !== "task_auto");
      return true;
    });
  }
  // A highlight without a record or completion is a valid synthetic day.
  private highlightExtras(records: JournalRecord[], highlights: JournalHighlight[]): JournalRecord[] {
    const days = new Map(records.filter(record => record.kind === "day").map(record => [record.start, record]));
    const extra = new Map<string, JournalRecord>();
    for (const item of highlights) {
      if (item.deletedAt || item.sourceType === "task") continue;
      const existing = days.get(item.date) ?? extra.get(item.date);
      if (existing || extra.has(item.date)) continue;
      extra.set(item.date, { ...emptyJournal("day", item.date), revision: 0, createdAt: item.createdAt, updatedAt: item.updatedAt, deletedAt: null, contentJson: null, contentRevision: 0 });
    }
    return [...extra.values()];
  }
  private read(): JournalRecord[] {
    const raw = this.storage().getItem(this.storageKey);
    if (!raw) return [];
    const records: JournalRecord[] = JSON.parse(raw);
    if (!Array.isArray(records)) throw new Error("日记存储格式无效。");
    return records.map(record => {
      if (!Number.isInteger(record.revision) || record.revision < 1) throw new Error("日记版本无效。");
      if (record.contentJson) parseJournalDocument(record.contentJson);
      return { ...record, ...parseJournalInput(record) };
    });
  }
  async list(): Promise<JournalRecord[]> {
    if (this.browser()) return mergeJournalCompletions(this.read(), this.readCompletions());
    const db = await this.database();
    const [records, completions] = await Promise.all([
      db.select<Row[]>("SELECT * FROM journal_records ORDER BY period_start DESC"),
      db.select<CompletionRow[]>("SELECT * FROM journal_task_completions ORDER BY day DESC,completed_at,id"),
    ]);
    return mergeJournalCompletions(records.map(mapRow), completions.map(mapCompletion));
  }
  async get(kind: JournalKind, start: string): Promise<JournalRecord | undefined> {
    checkKind(kind); parseDateKey(start);
    return (await this.range(start, start, [kind]))[0];
  }
  /** Inclusive period-start range, including tombstones. Defaults to daily records. */
  async range(from: string, to: string, kinds: JournalKind[] = ["day"]): Promise<JournalRecord[]> {
    checkRange(from, to); kinds.forEach(checkKind);
    const selected = [...new Set(kinds)];
    if (!selected.length) return [];
    if (this.browser()) {
      const records = this.read().filter(record => record.start >= from && record.start <= to && selected.includes(record.kind));
      const merged = mergeJournalCompletions(records, selected.includes("day") ? this.readCompletions().filter(value => value.day >= from && value.day <= to) : []);
      if (!selected.includes("day")) return merged;
      const extras = this.highlightExtras(merged, this.availableHighlights(records, this.readCompletions())).filter(record => record.start >= from && record.start <= to);
      return [...merged, ...extras].sort(recordOrder);
    }
    const db = await this.database();
    const [records, completions, highlightDays] = await Promise.all([
      db.select<Row[]>(`SELECT * FROM journal_records WHERE period_start>=? AND period_start<=? AND kind IN (${selected.map(() => "?").join(",")}) ORDER BY period_start DESC,kind`, [from, to, ...selected]),
      selected.includes("day") ? db.select<CompletionRow[]>("SELECT * FROM journal_task_completions WHERE day>=? AND day<=? ORDER BY completed_at,id", [from, to]) : Promise.resolve([]),
      selected.includes("day") ? db.select<Array<{ day: string; createdAt: string; updatedAt: string }>>(`${querySources()}
        SELECT date AS day,min(created_at) AS createdAt,max(updated_at) AS updatedAt
        FROM available_highlights WHERE source_type<>'task' GROUP BY date`, [from, to]) : Promise.resolve([]),
    ]);
    const merged = mergeJournalCompletions(records.map(mapRow), completions.map(mapCompletion));
    const present = new Set([...records.filter(record => record.kind === "day").map(record => record.period_start), ...merged.filter(record => record.kind === "day").map(record => record.start)]);
    const extras = highlightDays.filter(day => !present.has(day.day)).map(day => ({
      ...emptyJournal("day", day.day), revision: 0, createdAt: day.createdAt, updatedAt: day.updatedAt, deletedAt: null, contentJson: null, contentRevision: 0,
    }));
    return [...merged, ...extras].sort(recordOrder);
  }
  async index(from: string, to: string): Promise<JournalIndexEntry[]> {
    checkRange(from, to);
    if (this.browser()) {
      const highlights = this.availableHighlights(this.read(), this.readCompletions()).filter(item => item.sourceType !== "task" && item.date >= from && item.date <= to);
      return (await this.range(from, to, journalKinds)).map(record => ({
        kind: record.kind, start: record.start, deletedAt: record.deletedAt,
        hasContent: !!(record.title.trim() || record.text.trim() || record.items.length || record.contentJson || (record.kind === "day" && highlights.some(item => item.date === record.start))),
        completionCount: completionCount(record),
      }));
    }
    const rows = await (await this.database()).select<Array<JournalKey & { deletedAt: string | null; hasContent: number; completionCount: number }>>(`${querySources()}
      SELECT k.kind,k.period_start AS start,r.deleted_at AS deletedAt,
        (coalesce(r.has_content,0) OR coalesce(c.total,0)>0 OR coalesce(h.total,0)>0) AS hasContent,
        coalesce(c.total,0)+coalesce(l.total,0) AS completionCount
      FROM journal_keys k
      LEFT JOIN scoped_records r ON r.kind=k.kind AND r.period_start=k.period_start
      LEFT JOIN (SELECT day,count(*) AS total FROM visible_completions GROUP BY day) c ON k.kind='day' AND c.day=k.period_start
      LEFT JOIN (SELECT day,count(*) AS total FROM highlight_days GROUP BY day) h ON k.kind='day' AND h.day=k.period_start
      LEFT JOIN (
        SELECT kind,period_start,count(*) AS total FROM legacy_items
        WHERE json_extract(item,'$.origin')='task_auto' OR (
          json_extract(item,'$.taskId')>0 AND json_extract(item,'$.completedAt') IS NOT NULL
          AND substr(datetime(json_extract(item,'$.completedAt'),'localtime'),1,10)=period_start
        ) GROUP BY kind,period_start
      ) l ON l.kind=k.kind AND l.period_start=k.period_start
      ORDER BY k.period_start DESC,k.kind`, [from, to]);
    return rows.map(row => ({ ...row, hasContent: !!row.hasContent }));
  }
  async search(options: JournalSearchOptions): Promise<{ records: JournalRecord[]; hasMore: boolean }> {
    const { query, from = "1000-01-01", to = "9999-12-31", offset = 0, limit = 50, trash = false } = options;
    checkRange(from, to);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error("日记分页参数无效。");
    const pageSize = Math.min(limit, 50), keyword = searchFold(query.trim());
    if (this.browser()) {
      const highlights = trash ? [] : this.availableHighlights(this.read(), this.readCompletions());
      const hits = (await this.range(from, to, journalKinds)).filter(record => !!record.deletedAt === trash
        && matchesSearch(record, keyword, record.kind === "day" ? highlights.filter(item => item.date === record.start) : []));
      return { records: hits.slice(offset, offset + pageSize), hasMore: hits.length > offset + pageSize };
    }
    // Escape LIKE metacharacters as literals. All user input stays in bindings.
    const pattern = `%${keyword.replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const match = (column: string) => `${column} LIKE ?3 ESCAPE '\\'`;
    const keys = await (await this.database()).select<JournalKey[]>(`${querySources(true)}
      SELECT k.kind,k.period_start AS start FROM journal_keys k
      LEFT JOIN scoped_records r ON r.kind=k.kind AND r.period_start=k.period_start
      WHERE (r.deleted_at IS NOT NULL)=?4 AND (
        ?5='' OR ${match("r.title")} OR ${match("r.body")}
        OR (k.kind='day' AND EXISTS (SELECT 1 FROM available_highlights h WHERE h.date=k.period_start AND (
          ${match("h.summary")} OR ${match("h.result")} OR ${match("h.theme")}
        )))
        OR EXISTS (SELECT 1 FROM legacy_items l WHERE l.kind=k.kind AND l.period_start=k.period_start AND (
          ${["title", "notes", "theme", "client", "business", "nextAction"].map(field => match(`json_extract(l.item,'$.${field}')`)).join(" OR ")}
        ))
        OR (k.kind='day' AND EXISTS (SELECT 1 FROM visible_completions c WHERE c.day=k.period_start AND (${match("c.title")} OR ${match("c.notes")})))
      ) ORDER BY k.period_start DESC,k.kind LIMIT ?6 OFFSET ?7`, [from, to, pattern, trash ? 1 : 0, keyword, pageSize + 1, offset]);
    // Fetch only this page, including every completion for a matching day so callers
    // can generate snippets without receiving a filtered projection to save over it.
    const records = (await Promise.all(keys.slice(0, pageSize).map(key => this.get(key.kind, key.start)))).filter((record): record is JournalRecord => !!record);
    return { records: records.sort(recordOrder), hasMore: keys.length > pageSize };
  }
  async save(input: JournalInput, revision: number): Promise<void> {
    const parsed = parseJournalInput(handwrittenJournal(input)), now = new Date().toISOString();
    if (this.browser()) {
      const records = this.read(), existing = records.find(record => record.kind === parsed.kind && record.start === parsed.start);
      if ((existing?.revision ?? 0) !== revision) throw conflict();
      const next: JournalRecord = { ...existing, ...parsed, revision: revision + 1, createdAt: existing?.createdAt ?? now, updatedAt: now, deletedAt: null };
      this.storage().setItem(this.storageKey, JSON.stringify([...records.filter(record => record !== existing), next]));
      return;
    }
    const db = await this.database();
    const result = revision > 0
      ? await db.execute("UPDATE journal_records SET period_end=?,title=?,body=?,theme=?,important=?,items_json=?,revision=revision+1,updated_at=?,deleted_at=NULL WHERE kind=? AND period_start=? AND revision=?", [parsed.end, parsed.title, parsed.text, parsed.theme, parsed.important ? 1 : 0, JSON.stringify(parsed.items), now, parsed.kind, parsed.start, revision])
      : await db.execute(`INSERT INTO journal_records (kind,period_start,period_end,title,body,theme,important,items_json,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(kind,period_start) DO NOTHING`, [parsed.kind, parsed.start, parsed.end, parsed.title, parsed.text, parsed.theme, parsed.important ? 1 : 0, JSON.stringify(parsed.items), now, now]);
    if (result.rowsAffected !== 1) throw conflict();
  }
  async saveContent(kind: JournalInput["kind"], start: string, doc: JSONContent, revision: number): Promise<number> {
    const parsed = parseJournalDocument(doc), input = emptyJournal(kind, start);
    if (input.start !== start || !Number.isSafeInteger(revision) || revision < 0) throw new Error("日记日期或版本无效。");
    if (!this.browser()) {
      try { return await invoke<number>("save_journal_content", { kind, start, json: parsed.json, revision }); }
      catch (cause) { if (String(cause).includes("JOURNAL_CONTENT_CONFLICT")) throw conflict(); throw Object.assign(new Error(String(cause).includes("JOURNAL_IN_TRASH") ? "日记已在回收站，请先恢复。" : String(cause).includes("CONTENT_TOO_LONG") ? "日记正文超过 200000 个字符，请缩短后重试。" : "补充内容保存失败，输入已保留。请重试。"), { cause }); }
    }
    for (const asset of parsed.assets) await readBrowserJournalImage(this.draftNamespace, kind, start, asset);
    const records = this.read(), existing = records.find(record => record.kind === kind && record.start === start);
    if (existing?.deletedAt) throw new Error("日记已在回收站，请先恢复。");
    if ((existing?.contentRevision ?? 0) !== revision) throw conflict();
    const now = new Date().toISOString(), next: JournalRecord = { ...input, ...existing, text: parsed.text, contentJson: parsed.json, contentRevision: revision + 1, revision: (existing?.revision ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now, deletedAt: null };
    this.storage().setItem(this.storageKey, JSON.stringify([...records.filter(record => record !== existing), next]));
    return revision + 1;
  }
  async append(date: string, item: JournalInput["items"][number]): Promise<void> {
    // Re-read before appending, so quick entry never replaces the rest of a day.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.get("day", date);
      if (current?.deletedAt) throw new Error("这一天的日记在回收站，请先恢复后再添加记录。");
      if (current?.items.some(entry => entry.id === item.id)) return;
      const input: JournalInput = current ?? { kind: "day", start: date, end: date, title: "", text: "", theme: "", important: false, items: [] };
      try { await this.save({ ...input, items: [...input.items, item] }, current?.revision ?? 0); return; }
      catch (cause) { if (!(cause instanceof JournalConflictError) || attempt === 2) throw cause; }
    }
  }
  async remove(record: JournalRecord): Promise<void> {
    const now = new Date().toISOString();
    // Automatic-only days have no handwritten row yet. Persist a tombstone so
    // startup reconciliation and future task completions cannot revive them.
    if (record.revision === 0 && record.kind === "day") {
      if (this.browser()) {
        const records = this.read();
        if (records.some(item => item.kind === "day" && item.start === record.start)) throw conflict();
        const tombstone = { ...emptyJournal("day", record.start), revision: 1, createdAt: record.createdAt, updatedAt: now, deletedAt: now };
        this.storage().setItem(this.storageKey, JSON.stringify([...records, tombstone]));
      } else {
        const result = await (await this.database()).execute("INSERT INTO journal_records(kind,period_start,period_end,revision,created_at,updated_at,deleted_at) VALUES('day',?,?,1,?,?,?) ON CONFLICT(kind,period_start) DO NOTHING", [record.start, record.end, record.createdAt, now, now]);
        if (result.rowsAffected !== 1) throw conflict();
      }
      return;
    }
    if (this.browser()) {
      const records = this.read(), current = records.find(item => item.kind === record.kind && item.start === record.start);
      if (!current || current.revision !== record.revision) throw conflict();
      const next = records.map(item => item === current ? { ...item, revision: item.revision + 1, deletedAt: now, updatedAt: now } : item);
      this.storage().setItem(this.storageKey, JSON.stringify(next));
      return;
    }
    const result = await (await this.database()).execute("UPDATE journal_records SET deleted_at=?,updated_at=?,revision=revision+1 WHERE kind=? AND period_start=? AND revision=?", [now, now, record.kind, record.start, record.revision]);
    if (result.rowsAffected !== 1) throw conflict();
  }
}
const browserTestPage = import.meta.env.DEV && typeof location !== "undefined" && isBrowserDebug() ? location.pathname : "";
export const journalRepository = new JournalRepository(undefined, undefined, undefined,
  browserTestPage === "/bank-journal-test.html" ? BANK_JOURNAL_TEST_STORAGE_KEY : browserTestPage === "/work-journal-test.html" ? WORK_JOURNAL_TEST_STORAGE_KEY : JOURNAL_STORAGE_KEY);
