// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { emptyJournal } from "@/domain/journal";
import { JournalRepository, JOURNAL_STORAGE_KEY } from "./JournalRepository";

const input = { ...emptyJournal("day", "2026-10-07"), text: "每日成果", items: [{ id: "snapshot", title: "原始任务标题", notes: "完成联调", taskId: 1, completedAt: "2026-10-07T02:00:00.000Z", theme: "项目A", important: true }] };
const repo = () => new JournalRepository(undefined, () => true, () => localStorage);
beforeEach(() => localStorage.clear());
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
