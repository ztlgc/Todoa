// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { emptyJournal } from "@/domain/journal";
import { JournalRepository, JOURNAL_STORAGE_KEY, WORK_JOURNAL_TEST_STORAGE_KEY } from "./JournalRepository";
import { plainDocument } from "@/domain/contentDocument";

it("saves rich content independently, rejects stale edits and preserves it through trash restoration", async () => {
  await repo().save(input, 0);
  const doc = plainDocument("完整补充内容");
  expect(await repo().saveContent("day", input.start, doc, 0)).toBe(1);
  const saved = (await repo().list())[0];
  expect(saved.items).toEqual(input.items); expect(saved.contentJson).toBe(JSON.stringify(doc));
  await expect(repo().saveContent("day", input.start, plainDocument("过期内容"), 0)).rejects.toThrow("其他窗口");
  await repo().remove(saved);
  await expect(repo().saveContent("day", input.start, doc, 1)).rejects.toThrow("回收站");
  const removed = (await repo().list())[0]; await repo().save(removed, removed.revision);
  expect((await repo().list())[0].contentJson).toBe(JSON.stringify(doc));
});

const input = { ...emptyJournal("day", "2026-10-07"), text: "每日成果", items: [{ id: "snapshot", title: "原始任务标题", notes: "完成联调", taskId: 1, completedAt: "2026-10-07T02:00:00.000Z", theme: "项目A", important: true }] };
const repo = () => new JournalRepository(undefined, () => true, () => localStorage);
beforeEach(() => localStorage.clear());
it("isolates the real-work dataset without overwriting ordinary browser journals", async () => {
  await repo().save(input, 0);
  const original = localStorage.getItem(JOURNAL_STORAGE_KEY);
  const preview = () => new JournalRepository(undefined, () => true, () => localStorage, WORK_JOURNAL_TEST_STORAGE_KEY);
  await preview().save({ ...input, text: "真实工作样本" }, 0);
  expect((await preview().list())[0].text).toBe("真实工作样本");
  await preview().remove((await preview().list())[0]);
  expect((await preview().list())[0].deletedAt).toBeTruthy();
  expect(localStorage.getItem(JOURNAL_STORAGE_KEY)).toBe(original);
  expect((await repo().list())[0].deletedAt).toBeNull();
});
it("persists independent task snapshots and period summaries across repository reloads", async () => {
  await repo().save(input, 0);
  await repo().save({ ...emptyJournal("week", input.start), text: "周总结正文" }, 0);
  input.items[0].title = "任务改名";
  const records = await repo().list();
  expect(records.find(record => record.kind === "day")?.items[0].title).toBe("原始任务标题");
  expect(records.find(record => record.kind === "week")?.text).toBe("周总结正文");
  input.items[0].title = "原始任务标题";
});
it("rejects stale writes and preserves the last successful content", async () => {
  await repo().save(input, 0);
  await repo().save({ ...input, text: "另一窗口的修改" }, 1);
  await expect(repo().save({ ...input, text: "过时草稿" }, 1)).rejects.toThrow("其他窗口");
  await expect(repo().save(input, 0)).rejects.toThrow("其他窗口");
  expect((await repo().list())[0].text).toBe("另一窗口的修改");
});
it("soft deletes and restores complete snapshots", async () => {
  await repo().save(input, 0);
  await repo().remove((await repo().list())[0]);
  const deleted = (await repo().list())[0]; expect(deleted.deletedAt).toBeTruthy();
  await repo().save(deleted, deleted.revision);
  const restored = (await repo().list())[0]; expect(restored.deletedAt).toBeNull(); expect(restored.items).toEqual(input.items);
});
it("does not erase stored records on malformed data or quota failure", async () => {
  await repo().save(input, 0);
  const original = localStorage.getItem(JOURNAL_STORAGE_KEY);
  const failingStorage = { getItem: localStorage.getItem.bind(localStorage), setItem: vi.fn(() => { throw new Error("空间不足"); }) } as unknown as Storage;
  await expect(new JournalRepository(undefined, () => true, () => failingStorage).save({ ...input, text: "新草稿" }, 1)).rejects.toThrow("空间不足");
  expect(localStorage.getItem(JOURNAL_STORAGE_KEY)).toBe(original);
  localStorage.setItem(JOURNAL_STORAGE_KEY, "broken");
  await expect(repo().save(input, 0)).rejects.toThrow();
  expect(localStorage.getItem(JOURNAL_STORAGE_KEY)).toBe("broken");
});
