import { afterEach, expect, it, vi } from "vitest";
import { parseNaturalTaskInput } from "@/domain/naturalTaskInput";
import { browserTaskRepository, browserReminderRepository } from "./browserRepositories";

afterEach(() => vi.useRealTimers());

it("creates the reported daily reminder and retains the reminder on the next occurrence", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 7, 9));
  const input = parseNaturalTaskInput("每天明天早上十一点提醒我上班");
  const task = await browserTaskRepository.create(input);
  expect(task.repeatRule).toBe("day:1");
  expect(await browserReminderRepository.list(task.id)).toMatchObject([{ remindAt: task.dueAt }]);
  await browserTaskRepository.updateStatus(task.id, "completed");
  const next = (await browserTaskRepository.list({ status: "todo" })).find(item => item.id !== task.id)!;
  expect(new Date(next.dueAt!).getDate()).toBe(9);
  expect(new Date(next.dueAt!).getHours()).toBe(11);
  expect(await browserReminderRepository.list(next.id)).toMatchObject([{ remindAt: next.dueAt }]);
});

it("clearing recurrence preserves the deadline and reminders and stops subsequent occurrences", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 7, 9));
  const task = await browserTaskRepository.create(parseNaturalTaskInput("每天明天十一点提醒我清除重复验证"));
  const reminders = await browserReminderRepository.list(task.id);
  const before = (await browserTaskRepository.list()).length;
  const updated = await browserTaskRepository.update(task.id, { repeatRule: null });
  expect(updated.repeatRule).toBeNull();
  expect(updated.dueAt).toBe(task.dueAt);
  expect(await browserReminderRepository.list(task.id)).toEqual(reminders);
  await browserTaskRepository.updateStatus(task.id, "completed");
  expect((await browserTaskRepository.list()).length).toBe(before);
});
