// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyJournal, type JournalItem } from "@/domain/journal";
import type { SqlDatabase } from "@/data/db/SqlDatabase";
import { JournalConflictError, JournalRepository } from "./JournalRepository";

let database: DatabaseSync, adapter: SqlDatabase, journal: JournalRepository;
const date = "2026-10-17";
const item: JournalItem = { id: "client-entry/1", title: "确认续贷资料", notes: "缺少季度报表", client: "华兴制造", business: "续贷管理", activity: "phone", status: "waiting_client", nextAction: "催收季度报表", followUpAt: "2026-10-20T01:00:00.000Z", taskId: null, completedAt: null, theme: "", important: true };
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  for (const file of ["0001_initial.sql", "0002_natural_schedule.sql", "0003_task_priority.sql", "0004_task_trash.sql", "0005_journal.sql", "0006_task_content.sql", "0007_journal_task_completions.sql"]) database.exec(readFileSync(new URL(`../../../src-tauri/migrations/${file}`, import.meta.url), "utf8"));
  adapter = { select: async <T,>(sql: string, values = []) => database.prepare(sql).all(...values) as T,
    execute: async (sql, values = []) => { const result = database.prepare(sql).run(...values); return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) }; } };
  journal = new JournalRepository(async () => adapter, () => false);
});
afterEach(() => { database.close(); vi.restoreAllMocks(); });
it("round trips new banking metadata through the real SQLite schema alongside legacy records", async () => {
  await journal.save({ ...emptyJournal("day", date), title: "已有标题", text: "已有正文", items: [{ ...item, id: "legacy", client: undefined, status: undefined }] }, 0);
  await journal.append(date, item); await journal.append(date, item);
  const record = (await journal.list())[0];
  expect(record.items).toHaveLength(2); expect(record.items[1]).toEqual(item);
  expect(record.title).toBe("已有标题"); expect(record.text).toBe("已有正文");
  await journal.remove(record);
  await expect(journal.append(date, { ...item, id: "cannot-restore" })).rejects.toThrow("回收站");
  const deleted = (await journal.list())[0]; await journal.save(deleted, deleted.revision);
  expect((await journal.list())[0].items[1].followUpAt).toBe(item.followUpAt);
});
it("merges a quick entry after a competing writer instead of overwriting it", async () => {
  const save = journal.save.bind(journal);
  const spy = vi.spyOn(journal, "save").mockImplementationOnce(async () => {
    await save({ ...emptyJournal("day", date), text: "另一窗口的记录", items: [{ ...item, id: "other" }] }, 0);
    throw new JournalConflictError();
  }).mockImplementation(save);
  await journal.append(date, item);
  expect(spy).toHaveBeenCalledTimes(2);
  const record = (await journal.list())[0]; expect(record.text).toBe("另一窗口的记录"); expect(record.items.map(value => value.id)).toEqual(["other", item.id]);
});

it("merges persisted completion rows without consuming manual revisions, and tombstones automatic-only days", async () => {
  const stamp = "2026-10-17T02:00:00.000Z";
  database.prepare("INSERT INTO journal_task_completions(id,day,task_id,task_created_at,completed_at,title,notes) VALUES(?,?,?,?,?,?,?)")
    .run("auto:1",date,1,stamp,stamp,"完成时标题","原备注");
  const automatic = (await journal.list())[0];
  expect(automatic.revision).toBe(0); expect(automatic.items[0].origin).toBe("task_auto");
  await journal.remove(automatic);
  expect((await journal.list())[0].deletedAt).toBeTruthy();
  const tombstone = (await journal.list())[0]; await journal.save(tombstone,tombstone.revision);
  const opened = (await journal.list())[0];
  database.prepare("INSERT INTO journal_task_completions(id,day,task_id,task_created_at,completed_at,title) VALUES(?,?,?,?,?,?)")
    .run("auto:2",date,2,stamp,stamp,"编辑期间完成的任务");
  await journal.save({ ...opened,text:"不丢失的手写总结" },opened.revision);
  expect((await journal.list())[0].items).toHaveLength(2);
  expect((await journal.list())[0].text).toBe("不丢失的手写总结");
  expect(database.prepare("SELECT items_json FROM journal_records").get()).toMatchObject({ items_json:"[]" });
});
