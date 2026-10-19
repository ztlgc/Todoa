import { isBrowserDebug } from "@/app/browserDebug";
import { invoke } from "@tauri-apps/api/core";
import { initDatabase } from "@/data/db/initDatabase";
import type { SqlDatabase } from "@/data/db/SqlDatabase";
import { dateKey, emptyJournal, parseJournalInput, type JournalInput, type JournalRecord } from "@/domain/journal";
import { completionSnapshot, handwrittenJournal, mergeJournalCompletions, parseJournalCompletion, type JournalCompletion } from "@/domain/journalAutomation";
import type { Task, TaskStatus } from "@/domain/task";
import type { TaskList } from "@/domain/list";
import type { JSONContent } from "@tiptap/react";
import { parseJournalDocument } from "@/domain/journalContent";
import { readBrowserJournalImage } from "@/data/browserJournalImages";

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
      catch (cause) { if (String(cause).includes("JOURNAL_CONTENT_CONFLICT")) throw conflict(); throw Object.assign(new Error(String(cause).includes("JOURNAL_IN_TRASH") ? "日记已在回收站，请先恢复。" : "补充内容保存失败，输入已保留。请重试。"), { cause }); }
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
      const current = (await this.list()).find(record => record.kind === "day" && record.start === date);
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
