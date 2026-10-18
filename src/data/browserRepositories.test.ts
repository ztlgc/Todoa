import { afterEach, expect, it, vi } from "vitest";
import { parseNaturalTaskInput } from "@/domain/naturalTaskInput";
import { browserTaskRepository, browserReminderRepository, browserListRepository, browserTagRepository } from "./browserRepositories";
import { defaultRecurrence, parseRecurrence } from "@/domain/recurrence";

afterEach(() => vi.useRealTimers());

it("deletes only the selected task relations and preserves tasks when their list or tag is removed", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 17, 10));
  const due = new Date(2026, 9, 18, 9).toISOString();
  const list = await browserListRepository.create("删除关系测试清单");
  const tag = await browserTagRepository.create("待删除关系标签");
  const otherTag = await browserTagRepository.create("应保留关系标签");
  const retained = await browserTaskRepository.create({ title: "应保留的任务", notes: "应保留的内容", listId: list.id, priority: "high", dueAt: due, remindAt: [due], reminderOffsets: [0] });
  const removed = await browserTaskRepository.create({ title: "永久删除关系样本", listId: list.id, dueAt: due, remindAt: [due], reminderOffsets: [0] });
  await browserTagRepository.assign(retained.id, tag.id);
  await browserTagRepository.assign(retained.id, otherTag.id);
  await browserTagRepository.assign(removed.id, tag.id);
  expect(await browserReminderRepository.list(removed.id)).toHaveLength(1);

  await browserTaskRepository.trash(removed.id);
  await browserTaskRepository.delete(removed.id);
  expect(await browserTaskRepository.getById(removed.id)).toBeNull();
  expect((await browserTaskRepository.list({ deleted: true })).some(task => task.id === removed.id)).toBe(false);
  expect(await browserReminderRepository.list(removed.id)).toEqual([]);
  expect((await browserTagRepository.listTaskTags()).filter(link => link.taskId === removed.id)).toEqual([]);

  await browserListRepository.delete(list.id);
  await browserTagRepository.delete(tag.id);
  expect((await browserTaskRepository.list({ listId: null })).find(task => task.id === retained.id)).toMatchObject({ title: "应保留的任务", notes: "应保留的内容", priority: "high", dueAt: due, listId: null });
  expect((await browserTagRepository.listTaskTags()).filter(link => link.taskId === retained.id)).toEqual([{ taskId: retained.id, tagId: otherTag.id }]);
  expect(await browserReminderRepository.list(retained.id)).toMatchObject([{ remindAt: due }]);
  expect((await browserListRepository.list()).some(item => item.id === list.id)).toBe(false);
  expect((await browserTagRepository.list()).some(item => item.id === tag.id)).toBe(false);
  expect((await browserTagRepository.list()).some(item => item.id === otherTag.id)).toBe(true);
});

it("persists multi-weekday rules, preserves reminders, and stops at the occurrence limit", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026,9,5,8));
  const due = new Date(2026,9,5,9).toISOString();
  const rule = {...defaultRecurrence("2026-10-05"),weekdays:[1,3],end:"count",count:2};
  const task = await browserTaskRepository.create({title:"限定两次的周计划",dueAt:due,repeatRule:JSON.stringify(rule),remindAt:[due],reminderOffsets:[0]});
  await browserTaskRepository.updateStatus(task.id,"completed");
  const next = (await browserTaskRepository.list({status:"todo"})).find(t=>t.title===task.title)!;
  expect(new Date(next.dueAt!).getDate()).toBe(7);
  expect(parseRecurrence(next.repeatRule!)?.count).toBe(1);
  expect(await browserReminderRepository.list(next.id)).toMatchObject([{remindAt:next.dueAt}]);
  await browserTaskRepository.updateStatus(next.id,"completed");
  expect((await browserTaskRepository.list({status:"todo"})).filter(t=>t.title===task.title)).toHaveLength(0);
});

it("keeps date-only recurrence and rich content when generating the next occurrence", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 7, 9));
  const task = await browserTaskRepository.create({title:"全天重复",notes:"旧备注"});
  await browserTaskRepository.update(task.id,{dueAt:null,dueDate:"2026-10-08",repeatRule:"day:1",reminderOffsets:[]});
  task.contentJson = JSON.stringify({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"格式正文",marks:[{type:"bold"}]}]}]});
  const before = (await browserTaskRepository.list()).length;
  await browserTaskRepository.updateStatus(task.id,"completed");
  const next=(await browserTaskRepository.list({status:"todo"})).find(item=>item.title===task.title)!;
  expect(next).toMatchObject({dueAt:null,dueDate:"2026-10-09",contentJson:task.contentJson,contentRevision:0});
  expect(await browserReminderRepository.list(next.id)).toEqual([]);
  await browserTaskRepository.updateStatus(task.id,"completed");
  expect((await browserTaskRepository.list()).length).toBe(before+1);
});

it("creates the reported daily reminder and retains the reminder on the next occurrence", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 7, 9));
  const input = parseNaturalTaskInput("每天明天早上十一点提醒我上班");
  const task = await browserTaskRepository.create(input);
  expect(task.repeatRule).toBe("day:1");
  expect(await browserReminderRepository.list(task.id)).toMatchObject([{ remindAt: task.dueAt }]);
  await browserTaskRepository.updateStatus(task.id, "completed");
  const next = (await browserTaskRepository.list({ status: "todo" })).find(item => item.id !== task.id && item.title === task.title)!;
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
