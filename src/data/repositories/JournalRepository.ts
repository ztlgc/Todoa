import { isBrowserDebug } from "@/app/browserDebug";
import { initDatabase } from "@/data/db/initDatabase";
import type { SqlDatabase } from "@/data/db/SqlDatabase";
import { parseJournalInput, type JournalInput, type JournalRecord } from "@/domain/journal";

export const JOURNAL_STORAGE_KEY = "todoa.journal.v1";
const conflict = () => new Error("这份记录已在其他窗口更新，请重新打开后编辑。当前输入已保留。");
type Row = { kind: string; period_start: string; period_end: string; title: string; body: string; theme: string; important: number; items_json: string; revision: number; created_at: string; updated_at: string; deleted_at: string | null };
function mapRow(row: Row): JournalRecord {
  const input = parseJournalInput({ kind: row.kind as JournalInput["kind"], start: row.period_start, end: row.period_end, title: row.title, text: row.body, theme: row.theme, important: row.important === 1, items: JSON.parse(row.items_json) });
  return { ...input, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}
export class JournalRepository {
  constructor(private database: () => Promise<SqlDatabase> = initDatabase, private browser = isBrowserDebug, private storage: () => Storage = () => localStorage) {}
  private read(): JournalRecord[] {
    const raw = this.storage().getItem(JOURNAL_STORAGE_KEY);
    if (!raw) return [];
    const records: JournalRecord[] = JSON.parse(raw);
    if (!Array.isArray(records)) throw new Error("日记存储格式无效。");
    return records.map(record => {
      if (!Number.isInteger(record.revision) || record.revision < 1) throw new Error("日记版本无效。");
      return { ...record, ...parseJournalInput(record) };
    });
  }
  async list(): Promise<JournalRecord[]> {
    if (this.browser()) return this.read();
    return (await (await this.database()).select<Row[]>("SELECT * FROM journal_records ORDER BY period_start DESC")).map(mapRow);
  }
  async save(input: JournalInput, revision: number): Promise<void> {
    const parsed = parseJournalInput(input), now = new Date().toISOString();
    if (this.browser()) {
      const records = this.read(), existing = records.find(record => record.kind === parsed.kind && record.start === parsed.start);
      if ((existing?.revision ?? 0) !== revision) throw conflict();
      const next: JournalRecord = { ...parsed, revision: revision + 1, createdAt: existing?.createdAt ?? now, updatedAt: now, deletedAt: null };
      this.storage().setItem(JOURNAL_STORAGE_KEY, JSON.stringify([...records.filter(record => record !== existing), next]));
      return;
    }
    const db = await this.database();
    const result = revision > 0
      ? await db.execute("UPDATE journal_records SET period_end=?,title=?,body=?,theme=?,important=?,items_json=?,revision=revision+1,updated_at=?,deleted_at=NULL WHERE kind=? AND period_start=? AND revision=?", [parsed.end, parsed.title, parsed.text, parsed.theme, parsed.important ? 1 : 0, JSON.stringify(parsed.items), now, parsed.kind, parsed.start, revision])
      : await db.execute(`INSERT INTO journal_records (kind,period_start,period_end,title,body,theme,important,items_json,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(kind,period_start) DO NOTHING`, [parsed.kind, parsed.start, parsed.end, parsed.title, parsed.text, parsed.theme, parsed.important ? 1 : 0, JSON.stringify(parsed.items), now, now]);
    if (result.rowsAffected !== 1) throw conflict();
  }
  async remove(record: JournalRecord): Promise<void> {
    const now = new Date().toISOString();
    if (this.browser()) {
      const records = this.read(), current = records.find(item => item.kind === record.kind && item.start === record.start);
      if (!current || current.revision !== record.revision) throw conflict();
      const next = records.map(item => item === current ? { ...item, revision: item.revision + 1, deletedAt: now, updatedAt: now } : item);
      this.storage().setItem(JOURNAL_STORAGE_KEY, JSON.stringify(next));
      return;
    }
    const result = await (await this.database()).execute("UPDATE journal_records SET deleted_at=?,updated_at=?,revision=revision+1 WHERE kind=? AND period_start=? AND revision=?", [now, now, record.kind, record.start, record.revision]);
    if (result.rowsAffected !== 1) throw conflict();
  }
}
export const journalRepository = new JournalRepository();
