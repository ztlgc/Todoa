// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserTaskRepository } from "@/data/browserRepositories";
import { journalRepository } from "./JournalRepository";
import { dateKey } from "@/domain/journal";

vi.mock("@/app/browserDebug", () => ({ isBrowserDebug: () => true }));
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026,9,18,10)); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("captures from the actual browser completion path, preserving history through edit, trash and permanent deletion", async () => {
  const source = await browserTaskRepository.create({ title:"自动归档真实任务",notes:"任务完成时的备注" });
  await browserTaskRepository.updateStatus(source.id,"completed");
  vi.setSystemTime(new Date(2026,9,18,11));
  await browserTaskRepository.updateStatus(source.id,"completed");
  await browserTaskRepository.update(source.id,{ title:"之后修改标题",notes:"之后修改备注" });
  await browserTaskRepository.trash(source.id); await browserTaskRepository.delete(source.id);
  const record = (await journalRepository.list())[0];
  expect(record.start).toBe(dateKey(new Date())); expect(record.items).toHaveLength(1);
  expect(record.items[0]).toMatchObject({ title:"自动归档真实任务",notes:"任务完成时的备注",taskId:source.id });
});

it("does not complete the browser task when snapshot persistence fails, and retries without a duplicate", async () => {
  const source = await browserTaskRepository.create({ title:"写入失败需保留待办" });
  const write = vi.spyOn(Storage.prototype,"setItem").mockImplementationOnce(() => { throw new Error("空间不足"); });
  await expect(browserTaskRepository.updateStatus(source.id,"completed")).rejects.toThrow("空间不足");
  expect((await browserTaskRepository.getById(source.id))?.status).toBe("todo");
  write.mockRestore();
  await browserTaskRepository.updateStatus(source.id,"completed");
  expect((await journalRepository.list())[0].items).toHaveLength(1);
  await browserTaskRepository.updateStatus(source.id,"todo");
  expect(await journalRepository.list()).toEqual([]);
});
