// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { emptyJournal, type JournalItem } from "@/domain/journal";
import type { CreateTaskInput, Task } from "@/domain/task";
import { JournalRepository } from "./JournalRepository";
import { JournalFollowUpRepository, findFollowUp } from "./JournalFollowUpRepository";

const item: JournalItem = { id: "one", title: "确认资料", client: "华兴制造", business: "续贷管理", notes: "尚缺季度财报", nextAction: "催收财报", followUpAt: "2026-10-20T01:00:00.000Z", status: "waiting_client", taskId: null, completedAt: null, theme: "", important: false };
const date = "2026-10-17", createdAt = "2026-10-17T01:00:00.000Z";
beforeEach(() => localStorage.clear());
it("reuses an existing follow-up after its title and notes are edited", async () => {
  const journal = new JournalRepository(undefined, () => true, () => localStorage);
  await journal.save({ ...emptyJournal("day", date), items: [item] }, 0);
  const tasks: Task[] = [];
  const browser = { list: vi.fn(async (filters?: { deleted?: boolean }) => tasks.filter(task => !!task.deletedAt === !!filters?.deleted)),
    create: vi.fn(async (input: CreateTaskInput) => { const task: Task = { id: 1, title: input.title, notes: input.notes ?? "", dueAt: input.dueAt ?? null, createdAt, updatedAt: createdAt, listId: null, status: "todo", completedAt: null, sortOrder: 0 }; tasks.push(task); return task; }) };
  const repo = new JournalFollowUpRepository(() => true, browser, journal);
  await Promise.all([repo.create(date, item), repo.create(date, item)]);
  const linked = (await journal.list())[0].items[0];
  expect(linked.followUpTaskId).toBe(1); expect(linked.status).toBe("waiting_client"); expect(tasks[0].notes).toContain("来源：工作日记");
  tasks[0].notes = "编辑过的备注"; tasks[0].title = "改名后的跟进";
  expect(await new JournalFollowUpRepository(() => true, browser, journal).create(date, linked)).toBe(1);
  expect(findFollowUp(tasks, date, linked)?.title).toBe("改名后的跟进"); expect(browser.create).toHaveBeenCalledTimes(1);
  tasks[0].deletedAt = createdAt; await expect(repo.create(date, linked)).rejects.toThrow("回收站");
});
it("retries a failed journal link using the task already created", async () => {
  const journal = new JournalRepository(undefined, () => true, () => localStorage);
  await journal.save({ ...emptyJournal("day", date), items: [item] }, 0);
  const task: Task = { id: 4, title: "跟进", notes: "", dueAt: null, createdAt, updatedAt: createdAt, listId: null, status: "todo", completedAt: null, sortOrder: 0 };
  const tasks: Task[] = [];
  const browser = { list: vi.fn(async () => tasks), create: vi.fn(async () => { tasks.push(task); return task; }) };
  const repo = new JournalFollowUpRepository(() => true, browser, journal);
  const save = vi.spyOn(journal, "save"); save.mockRejectedValueOnce(new Error("disk full"));
  await expect(repo.create(date, item)).rejects.toThrow("disk full");
  expect(await repo.create(date, item)).toBe(4); expect(browser.create).toHaveBeenCalledTimes(1);
  expect((await journal.list())[0].items[0].followUpTaskCreatedAt).toBe(createdAt);
});
