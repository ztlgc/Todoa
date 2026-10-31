import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { emptyJournal, type JournalInput, type JournalItem, type JournalKind, type JournalRecord } from "@/domain/journal";
import { completionSnapshot, type JournalCompletion } from "@/domain/journalAutomation";
import type { JournalHighlight } from "@/domain/journalReview";
import type { Task } from "@/domain/task";
import type { SqlDatabase, SqlValue } from "@/data/db/SqlDatabase";
import { JOURNAL_STORAGE_KEY, JournalRepository } from "./JournalRepository";

const openDatabases: DatabaseSync[] = [];
afterEach(() => { for (const db of openDatabases.splice(0)) db.close(); });
const stamp = "2025-01-01T02:00:00.000Z";
const legacy = (id: string, title: string, extra: Partial<JournalItem> = {}): JournalItem => ({ id, title, notes: "", taskId: null, completedAt: null, theme: "", important: false, ...extra });
function snapshot(day: string, id: number, title = "快照关键词", extra: Partial<JournalCompletion> = {}): JournalCompletion {
  const task: Task = { id, createdAt: stamp, updatedAt: stamp, listId: null, dueAt: null, sortOrder: 0, completedAt: `${day}T04:00:00.000Z`, status: "completed", title, notes: "快照备注" };
  return { ...completionSnapshot(task, ""), ...extra, day };
}
function fixture(browser: boolean) {
  // Every desktop query executes against this fresh in-memory database. No app
  // initialization or production database is used by this suite.
  const db = new DatabaseSync(":memory:"); openDatabases.push(db);
  for (const file of ["0005_journal.sql", "0007_journal_task_completions.sql", "0008_journal_content.sql", "0009_journal_review.sql"]) {
    db.exec(readFileSync(new URL(`../../../src-tauri/migrations/${file}`, import.meta.url), "utf8"));
  }
  const storage = new Map<string, string>();
  const adapter: SqlDatabase = {
    select: vi.fn(async (query: string, values: SqlValue[] = []) => db.prepare(query).all(...values)) as SqlDatabase["select"],
    execute: vi.fn(async (query: string, values: SqlValue[] = []) => ({ rowsAffected: Number(db.prepare(query).run(...values).changes) })),
  };
  const repo = new JournalRepository(async () => adapter, () => browser, () => ({
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  }) as Storage);
  async function record(kind: JournalKind, day: string, extra: Partial<JournalInput> = {}, deleted = false) {
    const input = { ...emptyJournal(kind, day), ...extra };
    await repo.save(input, 0);
    if (deleted) await repo.remove((await repo.get(kind, input.start))!);
    return input;
  }
  function completions(values: JournalCompletion[]) {
    if (browser) storage.set(`${JOURNAL_STORAGE_KEY}.task-completions.v1`, JSON.stringify(values));
    else for (const { day, item, revokedDay } of values) db.prepare(`INSERT INTO journal_task_completions
      (id,day,task_id,task_created_at,completed_at,title,notes,theme,important,revoked_at,revoked_day) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(item.id, day, item.taskId, item.taskCreatedAt, item.completedAt, item.title, item.notes, item.theme, item.important ? 1 : 0, item.revokedAt ?? null, revokedDay);
  }
  function highlights(values: JournalHighlight[]) {
    if (browser) storage.set(`${JOURNAL_STORAGE_KEY}.review.v1`, JSON.stringify(values));
    else for (const value of values) db.prepare(`INSERT INTO journal_highlights
      (id,date,summary,result,theme,source_type,source_id,source_revision,revision,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(value.id, value.date, value.summary, value.result, value.theme, value.sourceType, value.sourceId, value.sourceRevision, value.revision, value.createdAt, value.updatedAt, value.deletedAt);
  }
  return { repo, db, adapter, record, completions, highlights, storage };
}
const highlight = (id: string, date: string, summary: string, extra: Partial<JournalHighlight> = {}): JournalHighlight => ({
  id, date, summary, result: "", theme: "", sourceType: "note", sourceId: "note", sourceRevision: 0,
  revision: 1, createdAt: stamp, updatedAt: stamp, deletedAt: null, sourceDeleted: false, sourceChanged: false, sourceRevoked: false, ...extra,
});

for (const browser of [false, true]) describe(browser ? "browser queries" : "SQLite queries", () => {
  it("gets one kind/day, merges automatic-only days and preserves tombstones and source IDs", async () => {
    const { repo, record, completions } = fixture(browser);
    await record("day", "2025-01-02", { text: "正文" });
    await record("month", "2025-01-01", { title: "月总结" });
    const auto = snapshot("2025-01-02", 1), only = snapshot("2025-01-03", 2);
    completions([auto, only]);
    expect((await repo.get("day", "2025-01-02"))?.items[0].id).toBe(auto.item.id);
    expect((await repo.get("day", "2025-01-03"))?.revision).toBe(0);
    expect((await repo.get("month", "2025-01-01"))?.title).toBe("月总结");
    expect(await repo.get("week", "2025-01-01")).toBeUndefined();
    await repo.remove((await repo.get("day", "2025-01-03"))!);
    expect((await repo.get("day", "2025-01-03"))?.deletedAt).toBeTruthy();
    expect((await repo.get("day", "2025-01-03"))?.items[0].id).toBe(only.item.id);
  });

  it("bounds ranges across years, defaults to daily and includes deleted rows", async () => {
    const { repo, record, completions } = fixture(browser);
    await record("day", "2024-12-30", { text: "范围外" });
    await record("day", "2024-12-31", { text: "旧年" }, true);
    await record("month", "2025-01-01", { text: "月份" });
    await record("year", "2025-01-01", { text: "年度" });
    await record("week", "2024-12-30", { text: "周总结" });
    completions([snapshot("2025-01-01", 1), snapshot("2025-01-03", 2)]);
    const rows = await repo.range("2024-12-31", "2025-01-01");
    expect(rows.map(row => row.start)).toEqual(["2025-01-01", "2024-12-31"]);
    expect(rows[1].deletedAt).toBeTruthy();
    expect((await repo.range("2024-12-31", "2025-01-01", ["month", "year"])).map(row => row.kind)).toEqual(["month", "year"]);
    expect(await repo.range("2024-12-31", "2025-01-01", [])).toEqual([]);
  });

  it("indexes empty, handwritten, image-only, automatic-only and deleted days without duplicating snapshots", async () => {
    const { repo, record, completions, db, storage, adapter } = fixture(browser);
    await record("day", "2025-01-01");
    await record("day", "2025-01-02", { title: "旧标题" });
    const auto = snapshot("2025-01-03", 1);
    const duplicate = { ...auto.item, origin: undefined, id: "legacy-source" };
    await record("day", auto.day, { items: [duplicate] });
    await record("day", "2025-01-04", {}, true);
    await record("month", "2025-01-01", { text: "总结" });
    const json = JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: "todoa-asset:1" } }] });
    await record("day", "2025-01-06");
    if (browser) {
      const rows = JSON.parse(storage.get(JOURNAL_STORAGE_KEY)!) as JournalRecord[];
      rows.find(row => row.start === "2025-01-06")!.contentJson = json;
      storage.set(JOURNAL_STORAGE_KEY, JSON.stringify(rows));
    } else db.prepare("UPDATE journal_records SET content_json=? WHERE period_start=?").run(json, "2025-01-06");
    const hidden = snapshot("2025-01-07", 4); hidden.revokedDay = hidden.day; hidden.item.revokedAt = "2025-01-07T05:00:00.000Z";
    const revoked = snapshot("2025-01-08", 5); revoked.revokedDay = "2025-01-09"; revoked.item.revokedAt = "2025-01-09T05:00:00.000Z";
    completions([auto, snapshot("2025-01-04", 2), snapshot("2025-01-05", 3), hidden, revoked]);
    vi.mocked(adapter.select).mockClear();
    const index = await repo.index("2025-01-01", "2025-01-09");
    expect(index.find(row => row.start === "2025-01-07")).toBeUndefined();
    expect(index.find(row => row.start === "2025-01-01" && row.kind === "day")).toMatchObject({ hasContent: false, completionCount: 0 });
    for (const day of ["2025-01-03", "2025-01-04", "2025-01-05", "2025-01-08"]) expect(index.find(row => row.start === day)).toMatchObject({ hasContent: true, completionCount: 1 });
    expect(index.find(row => row.start === "2025-01-04")?.deletedAt).toBeTruthy();
    expect(index.find(row => row.start === "2025-01-06")?.hasContent).toBe(true);
    if (!browser) {
      expect(adapter.select).toHaveBeenCalledTimes(1);
      const sql = vi.mocked(adapter.select).mock.calls[0][0];
      expect(sql).not.toContain("SELECT * FROM journal_records");
      expect(sql).not.toContain("json_each(r.content_json)");
    }
  });

  it("searches full matching records in all kinds and respects literal LIKE characters, case, range and trash", async () => {
    const { repo, record, completions } = fixture(browser);
    await record("day", "2024-12-31", { text: "中文 AbC 100%_\\命中", items: [legacy("unmatched", "其他内容")] });
    await record("day", "2025-01-01", { title: "ABC 100xx" });
    await record("day", "2025-01-02", { items: [legacy("old", "旧标题", { notes: "旧备注中文" })] });
    await record("week", "2025-01-01", { title: "中文周总结" });
    await record("month", "2025-01-01", { text: "中文月总结" });
    await record("year", "2025-01-01", { text: "中文年总结" }, true);
    const hidden = snapshot("2025-01-03", 1, "隐藏关键词"); hidden.revokedDay = hidden.day; hidden.item.revokedAt = "2025-01-03T05:00:00.000Z";
    const later = snapshot("2025-01-04", 2, "跨日撤销关键词"); later.revokedDay = "2025-01-05"; later.item.revokedAt = "2025-01-05T05:00:00.000Z";
    completions([hidden, later, snapshot("2025-01-06", 3, "自动中文")]);
    expect((await repo.search({ query: "100%_\\" })).records.map(row => row.start)).toEqual(["2024-12-31"]);
    expect((await repo.search({ query: "abc" })).records).toHaveLength(2);
    const full = (await repo.search({ query: "中文 AbC" })).records[0];
    expect(full.items[0].id).toBe("unmatched");
    expect((await repo.search({ query: "旧备注" })).records[0].items[0].id).toBe("old");
    expect((await repo.search({ query: "隐藏关键词" })).records).toEqual([]);
    expect((await repo.search({ query: "跨日撤销" })).records[0].items[0].id).toBe(later.item.id);
    expect((await repo.search({ query: "快照备注" })).records).toHaveLength(2);
    expect((await repo.search({ query: "中文", from: "2025-01-01", to: "2025-01-31" })).records.map(row => row.kind)).toEqual(["day", "day", "month"]);
    expect((await repo.search({ query: "中文", trash: true })).records.map(row => row.kind)).toEqual(["year"]);
    expect((await repo.search({ query: "中文周" })).records[0].kind).toBe("week");
  });

  it("does not match duplicate completion text hidden behind the legacy source", async () => {
    const { repo, record, completions } = fixture(browser);
    const auto = snapshot("2025-01-01", 1, "重复快照隐藏内容");
    await record("day", auto.day, { items: [legacy("old-source", "旧快照权威标题", { taskId: auto.item.taskId, completedAt: auto.item.completedAt })] });
    completions([auto]);
    expect((await repo.search({ query: "隐藏内容" })).records).toEqual([]);
    expect((await repo.search({ query: "权威标题" })).records[0].items.map(item => item.id)).toEqual(["old-source"]);
  });

  it("synthesizes highlight-only days for get/range/index and includes their summary, result and theme in search", async () => {
    const { repo, record, completions, highlights } = fixture(browser);
    await record("day", "2025-02-01", { text: "普通正文" }, true);
    await record("month", "2025-02-01", { text: "月份记录" });
    const active = snapshot("2025-02-02", 1), revoked = snapshot("2025-02-06", 2);
    revoked.revokedDay = "2025-02-07"; revoked.item.revokedAt = "2025-02-07T05:00:00.000Z";
    completions([active, revoked]);
    highlights([
      highlight("note-1", "2025-02-03", "重点摘要甲", { result: "结果乙", theme: "主题丙" }),
      highlight("note-1b", "2025-02-03", "同日第二个重点"),
      highlight("task-edited", active.day, "编辑后的任务重点", { sourceType: "task", sourceId: active.item.id }),
      highlight("task-revoked", revoked.day, "撤销后的任务重点", { sourceType: "task", sourceId: revoked.item.id }),
      highlight("legacy-missing", "2025-02-08", "来源不存在的旧重点", { sourceType: "legacy", sourceId: "missing" }),
      highlight("note-2", "2025-02-01", "回收站日的重点"),
      highlight("note-3", "2025-02-04", "已删除重点", { deletedAt: stamp }),
      highlight("task-1", "2025-02-05", "任务重点", { sourceType: "task", sourceId: "task" }),
    ]);
    expect(await repo.get("day", "2025-02-03")).toMatchObject({ revision: 0, text: "", items: [], deletedAt: null });
    expect(await repo.get("day", "2025-02-04")).toBeUndefined();
    expect((await repo.get("day", "2025-02-01"))?.deletedAt).toBeTruthy();
    expect((await repo.range("2025-02-01", "2025-02-05")).map(row => row.start)).toEqual(["2025-02-03", "2025-02-02", "2025-02-01"]);
    const index = await repo.index("2025-02-01", "2025-02-05");
    expect(index.find(row => row.start === "2025-02-03")).toMatchObject({ hasContent: true, completionCount: 0 });
    expect(index.find(row => row.start === "2025-02-04")).toBeUndefined();
    expect((await repo.search({ query: "摘要甲" })).records[0]).toMatchObject({ start: "2025-02-03", revision: 0 });
    expect((await repo.search({ query: "结果乙" })).records.map(row => row.start)).toEqual(["2025-02-03"]);
    expect((await repo.search({ query: "主题丙" })).records.map(row => row.start)).toEqual(["2025-02-03"]);
    expect((await repo.search({ query: "编辑后的任务重点" })).records.map(row => row.start)).toEqual([active.day]);
    expect((await repo.search({ query: "撤销后的任务重点" })).records).toEqual([]);
    expect((await repo.search({ query: "来源不存在的旧重点" })).records).toEqual([]);
    const highlightPage = await repo.search({ query: "重点", limit: 1 });
    expect(highlightPage.records.map(row => row.start)).toEqual(["2025-02-03"]); expect(highlightPage.hasMore).toBe(true);
    expect((await repo.search({ query: "重点", limit: 1, offset: 1 })).records.map(row => row.start)).toEqual([active.day]);
    await repo.remove((await repo.get("day", "2025-02-03"))!);
    expect((await repo.get("day", "2025-02-03"))?.deletedAt).toBeTruthy();
    expect((await repo.search({ query: "摘要甲" })).records).toEqual([]);
    expect((await repo.search({ query: "回收站日的重点" })).records).toEqual([]);
    expect((await repo.search({ query: "回收站日的重点", trash: true })).records).toEqual([]);
    expect((await repo.search({ query: "普通正文", trash: true })).records.map(row => row.start)).toEqual(["2025-02-01"]);
  });

  it("pages deterministically by date and kind, clamps to 50 and reports exact final-page hasMore", async () => {
    const { repo, record } = fixture(browser);
    for (let day = 1; day <= 60; day++) {
      const date = new Date(Date.UTC(2024, 11, day)).toISOString().slice(0, 10);
      await record("day", date, { text: "分页" });
    }
    await record("month", "2025-01-01", { text: "分页" });
    await record("year", "2025-01-01", { text: "分页" });
    const first = await repo.search({ query: "分页", limit: 999 });
    const second = await repo.search({ query: "分页", offset: 50, limit: 50 });
    expect(first.records).toHaveLength(50); expect(first.hasMore).toBe(true);
    expect(second.records).toHaveLength(12); expect(second.hasMore).toBe(false);
    const keys = [...first.records, ...second.records].map(row => `${row.start}/${row.kind}`);
    expect(new Set(keys).size).toBe(62);
    expect(first.records[0].start).toBe("2025-01-29");
    expect(keys.filter(key => key.startsWith("2025-01-01"))).toEqual(["2025-01-01/day", "2025-01-01/month", "2025-01-01/year"]);
    expect(await repo.search({ query: "分页", offset: 62 })).toEqual({ records: [], hasMore: false });
    expect((await repo.search({ query: "", limit: 1 })).hasMore).toBe(true);
  });

  it("rejects malformed bounds and pagination before reading storage", async () => {
    const { repo } = fixture(browser);
    await expect(repo.range("2025-02-30", "2025-03-01")).rejects.toThrow();
    await expect(repo.index("2025-02-01", "2025-01-01")).rejects.toThrow();
    await expect(repo.search({ query: "", offset: -1 })).rejects.toThrow();
    await expect(repo.search({ query: "", limit: 0 })).rejects.toThrow();
  });
});

it("desktop get/range constrain SQL and append never calls compatibility list", async () => {
  const { repo, record, adapter } = fixture(false);
  await record("day", "2025-01-01", { text: "keep" });
  vi.mocked(adapter.select).mockClear();
  const list = vi.spyOn(repo, "list").mockRejectedValue(new Error("full list forbidden"));
  await repo.append("2025-01-01", legacy("added", "补记"));
  expect(list).not.toHaveBeenCalled();
  expect((await repo.get("day", "2025-01-01"))?.text).toBe("keep");
  expect(vi.mocked(adapter.select).mock.calls.every(([sql, values]) => sql.includes("WHERE")
    && (sql.includes("period_start>=") || sql.includes("day>=") || sql.includes("date>="))
    && Array.isArray(values) && values.includes("2025-01-01"))).toBe(true);
  vi.mocked(adapter.select).mockClear();
  await repo.get("month", "2025-01-01");
  expect(adapter.select).toHaveBeenCalledTimes(1);
  expect(vi.mocked(adapter.select).mock.calls[0][1]).toEqual(["2025-01-01", "2025-01-01", "month"]);
});

it("browser get/range preserve review metadata extensions and storage namespaces", async () => {
  const { repo, record, storage } = fixture(true);
  await record("day", "2025-01-01");
  const rows = JSON.parse(storage.get(JOURNAL_STORAGE_KEY)!);
  rows[0].reviewSources = [{ id: "source-1" }];
  storage.set(JOURNAL_STORAGE_KEY, JSON.stringify(rows));
  expect(await repo.get("day", "2025-01-01")).toHaveProperty("reviewSources", [{ id: "source-1" }]);
  expect((await repo.range("2025-01-01", "2025-01-01"))[0]).toHaveProperty("reviewSources");
  expect([...storage.keys()]).toEqual([JOURNAL_STORAGE_KEY]);
});
