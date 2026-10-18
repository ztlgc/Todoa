// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dateKey, emptyJournal, journalMarkdown, summaryMaterials, workStatus } from "@/domain/journal";
import type { Task } from "@/domain/task";
import { JournalRepository } from "./JournalRepository";

const day = "2026-10-18";
const at = (date = day, clock = "10:00") => new Date(`${date}T${clock}:00`).toISOString();
const task = (id = 1): Task => ({ id, listId: null, title: "提交甲公司授信材料", notes: "已提交，等待审批反馈", status: "todo", priority: "high", dueAt: at("2026-10-17"), completedAt: null, sortOrder: 0, createdAt: at("2026-10-16"), updatedAt: at("2026-10-16") });
const repository = () => new JournalRepository(undefined, () => true, () => localStorage, "auto-test");
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date(`${day}T10:00:00`)); });
afterEach(() => vi.useRealTimers());

it("persists actual completion snapshots once across reload and leaves later source changes alone", async () => {
  const repo = repository(), source = task();
  source.notes = "长".repeat(100000);
  repo.recordBrowserTaskStatus(source, "completed", at(), "客户维护");
  const complete = { ...source, status: "completed" as const, completedAt: at() };
  repo.recordBrowserTaskStatus(complete, "completed", at(day, "11:00"));
  await repo.reconcile([{ ...complete, title: "之后改名", notes: "修改后" }]);
  const record = (await repository().list())[0];
  expect(record.start).toBe(day); expect(record.revision).toBe(0); expect(record.items).toHaveLength(1);
  expect(record.items[0]).toMatchObject({ title: source.title, theme: "客户维护", important: true, completedAt: at(), origin: "task_auto" });
  expect(record.items[0].notes).toHaveLength(100000);
});

it("uses the local completion day across midnight rather than the deadline", async () => {
  const repo = repository();
  repo.recordBrowserTaskStatus(task(1), "completed", at(day,"23:59"));
  repo.recordBrowserTaskStatus(task(2), "completed", at("2026-10-19","00:01"));
  expect((await repo.list()).map(record => record.start)).toEqual(["2026-10-19",day]);
});

it("preserves an open manual draft while new automatic entries arrive, including its first save", async () => {
  const repo = repository(), draft = { ...emptyJournal("day",day), text: "尚未提交的客户反馈" };
  repo.recordBrowserTaskStatus(task(1), "completed", at());
  await repo.save(draft,0);
  const opened = (await repo.list())[0];
  repo.recordBrowserTaskStatus(task(2), "completed", at(day,"11:00"));
  await repo.save({ ...opened, text: "完整手写总结", items: opened.items.map(item => ({ ...item, title: "自动快照不能被草稿覆盖" })) },opened.revision);
  const saved = (await repo.list())[0];
  expect(saved.text).toBe("完整手写总结"); expect(saved.items).toHaveLength(2);
  expect(saved.items[0].title).toBe(task().title);
  const raw = JSON.parse(localStorage.getItem("auto-test")!);
  expect(raw[0].items).toEqual([]);
});

it("withdraws a same-day accidental completion and retains a cross-day revocation in history and export", async () => {
  const repo = repository(), source = task();
  repo.recordBrowserTaskStatus(source,"completed",at());
  repo.recordBrowserTaskStatus({ ...source,status:"completed",completedAt:at() },"todo",at(day,"11:00"));
  expect(await repo.list()).toEqual([]);
  repo.recordBrowserTaskStatus(source,"completed",at("2026-10-19"));
  repo.recordBrowserTaskStatus({ ...source,status:"completed",completedAt:at("2026-10-19") },"todo",at("2026-10-20"));
  const records = await repo.list();
  expect(records).toHaveLength(1); expect(records[0].start).toBe("2026-10-19");
  expect(workStatus(records[0].items[0])).toBe("revoked");
  const summary = summaryMaterials(records,"month",day);
  expect(summary).toContain("完成后撤销"); expect(summary).not.toContain("### 已完成事项");
  expect(journalMarkdown(records,"month",day)).toContain("完成已撤销");
  expect(journalMarkdown(records,"month",day)).toContain("撤销于");
});

it("does not resurrect a deliberately deleted automatic day and restores it with subsequent snapshots", async () => {
  const repo = repository(), source = task();
  repo.recordBrowserTaskStatus(source,"completed",at());
  await repo.remove((await repo.list())[0]);
  repo.recordBrowserTaskStatus(task(2),"completed",at(day,"11:00"));
  await repo.reconcile([{ ...source,status:"completed",completedAt:at() }]);
  const deleted = (await repository().list())[0];
  expect(deleted.deletedAt).toBeTruthy(); expect(deleted.items).toHaveLength(2);
  await repo.save(deleted,deleted.revision);
  expect((await repo.list())[0].deletedAt).toBeNull(); expect((await repo.list())[0].items).toHaveLength(2);
});

it("deduplicates an already collected completion but preserves a separate progress note and task identity", async () => {
  const repo = repository(), source = task(), completion = at();
  await repo.save({ ...emptyJournal("day",day),items:[
    { id:"manual-completion",title:source.title,notes:"手工收录",taskId:source.id,taskCreatedAt:source.createdAt,completedAt:completion,theme:"",important:false },
    { id:"manual-progress",title:"上午沟通进展",notes:"仍在协调",taskId:source.id,taskCreatedAt:source.createdAt,completedAt:null,status:"progress",theme:"",important:false },
  ] },0);
  repo.recordBrowserTaskStatus(source,"completed",completion);
  expect((await repo.list())[0].items.map(item => item.id)).toEqual(["manual-completion","manual-progress"]);
  repo.recordBrowserTaskStatus({ ...source,createdAt:at(day,"09:00") },"completed",completion);
  expect((await repo.list())[0].items).toHaveLength(3);
});

it("backfills only available completion facts and surfaces corrupt automatic storage without overwriting it", async () => {
  const repo = repository(), source = task();
  await repo.reconcile([source]); expect(await repo.list()).toEqual([]);
  await repo.reconcile([{ ...source,status:"completed",completedAt:at(),deletedAt:at(day,"11:00") }]);
  expect((await repo.list())[0].items).toHaveLength(1);
  localStorage.setItem("auto-test.task-completions.v1","broken");
  await expect(repo.reconcile([{ ...source,status:"completed",completedAt:at() }])).rejects.toThrow();
  expect(() => repo.recordBrowserTaskStatus(task(2),"completed",at())).toThrow();
  expect(localStorage.getItem("auto-test.task-completions.v1")).toBe("broken");
});

it("keeps zero-completion days empty", async () => {
  await repository().reconcile([]);
  expect(await repository().list()).toEqual([]);
  expect(dateKey(new Date(at()))).toBe(day);
});

it("preserves valid Unicode task lengths without making the automatic journal unreadable", async () => {
  const repo = repository(), source = { ...task(),title:"🏦".repeat(500),notes:"📋".repeat(100000) };
  repo.recordBrowserTaskStatus(source,"completed",at(),"🏢".repeat(100));
  const record = (await repo.list())[0];
  expect(record.items[0].title).toBe(source.title); expect(record.items[0].notes).toBe(source.notes);
  await repo.save({ ...record,text:"长备注与手写总结独立保存" },0);
  expect((await repo.list())[0].items[0].notes).toBe(source.notes);
});
