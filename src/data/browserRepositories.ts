import { parseCreateTaskInput, parseTaskFilters, parseTaskId, parseTaskStatus, parseTaskTime, parseUpdateTaskInput, type CreateTaskInput, type Task, type TaskFilters, type TaskStatus, type UpdateTaskInput } from "@/domain/task";
import { parseListId, parseListName, type TaskList } from "@/domain/list";
import { parseTagId, parseTagName, TagConflictError, type Tag, type TaskTag } from "@/domain/tag";
import type { Reminder } from "./repositories/ReminderRepository";
import { nextRepeatDue } from "@/domain/naturalTaskInput";

// Browser dev data is deliberately separate from the desktop SQLite database.
const state = {
  tasks: [] as Task[], lists: [] as TaskList[], tags: [] as Tag[], taskTags: [] as TaskTag[], reminders: [] as Reminder[],
  generatedReminderIds: new Set<number>(),
  nextTask: 1, nextList: 1, nextTag: 1, nextReminder: 1,
};
const stamp = () => new Date().toISOString();
const futureTime = (value: string) => { const time = parseTaskTime(value); if (Date.parse(time) <= Date.now()) throw new Error("请选择未来时刻。"); return time; };

export const browserTaskRepository = {
  async list(filters: TaskFilters = {}): Promise<Task[]> {
    const scope = parseTaskFilters(filters);
    return state.tasks.filter((task) => {
      if (scope.status && task.status !== scope.status) return false;
      if (scope.listId !== undefined && task.listId !== scope.listId) return false;
      if (scope.tagId !== undefined && !state.taskTags.some((link) => link.taskId === task.id && link.tagId === scope.tagId)) return false;
      if (scope.dateRange && (!task.dueAt || task.dueAt < scope.dateRange.from || (scope.dateRange.to && task.dueAt >= scope.dateRange.to))) return false;
      return true;
    }).sort((a, b) => scope.dateView ? (a.dueAt ?? "").localeCompare(b.dueAt ?? "") || a.sortOrder - b.sortOrder || a.id - b.id : a.sortOrder - b.sortOrder || a.id - b.id);
  },
  async getById(id: number): Promise<Task | null> { return state.tasks.find((task) => task.id === parseTaskId(id)) ?? null; },
  async create(input: CreateTaskInput): Promise<Task> {
    const parsed = parseCreateTaskInput(input), now = stamp();
    const task: Task = { id: state.nextTask++, title: parsed.title, listId: parsed.listId, notes: parsed.notes, dueAt: parsed.dueAt, repeatRule: parsed.repeatRule, reminderOffsets: parsed.reminderOffsets, priority: parsed.priority, status: "todo", completedAt: null, sortOrder: state.tasks.length, createdAt: now, updatedAt: now };
    if (parsed.remindAt.some(time => Date.parse(time) <= Date.now())) throw new Error("提醒时间已过去，请调整时间。");
    state.tasks.push(task);
    for (const time of parsed.remindAt) {
      const id = state.nextReminder++;
      state.reminders.push({ id, taskId: task.id, remindAt: time, triggeredAt: null });
      state.generatedReminderIds.add(id);
    }
    return task;
  },
  async update(id: number, input: UpdateTaskInput): Promise<Task> {
    const task = state.tasks.find((item) => item.id === parseTaskId(id));
    if (!task) throw new Error("任务不存在");
    const parsed = parseUpdateTaskInput(input);
    const changedDue = parsed.dueAt !== undefined && parsed.dueAt !== task.dueAt;
    if (changedDue) {
      state.reminders = state.reminders.filter(reminder => reminder.taskId !== task.id || reminder.triggeredAt !== null || !state.generatedReminderIds.has(reminder.id));
    }
    Object.assign(task, parsed, { updatedAt: stamp() });
    if (changedDue) {
      if (!task.dueAt) { task.repeatRule = null; task.reminderOffsets = []; }
      else if (task.status === "todo") {
        for (const offset of task.reminderOffsets ?? []) {
          const remindAt = new Date(Date.parse(task.dueAt) - offset * 60000).toISOString();
          if (Date.parse(remindAt) <= Date.now()) continue;
          const id = state.nextReminder++;
          state.reminders.push({ id, taskId: task.id, remindAt, triggeredAt: null });
          state.generatedReminderIds.add(id);
        }
      }
    }
    return { ...task };
  },
  async updateStatus(id: number, status: TaskStatus): Promise<void> {
    const task = state.tasks.find((item) => item.id === parseTaskId(id));
    if (!task) throw new Error("任务不存在");
    const wasTodo = task.status === "todo";
    task.status = parseTaskStatus(status); task.completedAt = status === "completed" ? stamp() : null; task.updatedAt = stamp();
    if (status === "completed") {
      state.reminders = state.reminders.filter(reminder => reminder.taskId !== task.id || reminder.triggeredAt !== null);
      if (wasTodo && task.repeatRule && task.dueAt) {
        const dueAt = nextRepeatDue(task.dueAt, task.repeatRule);
        if (dueAt) {
          const next: Task = { ...task, id: state.nextTask++, dueAt, status: "todo", completedAt: null, createdAt: stamp(), updatedAt: stamp() };
          state.tasks.push(next);
          for (const link of state.taskTags.filter(link => link.taskId === task.id)) state.taskTags.push({ taskId: next.id, tagId: link.tagId });
          for (const offset of task.reminderOffsets ?? []) {
            const remindAt = new Date(Date.parse(dueAt) - offset * 60000).toISOString();
            if (Date.parse(remindAt) > Date.now()) {
              const id = state.nextReminder++;
              state.reminders.push({ id, taskId: next.id, remindAt, triggeredAt: null });
              state.generatedReminderIds.add(id);
            }
          }
        }
      }
    }
  },
  async delete(id: number): Promise<void> {
    const taskId = parseTaskId(id), index = state.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) throw new Error("任务不存在");
    state.tasks.splice(index, 1);
    state.taskTags = state.taskTags.filter((link) => link.taskId !== taskId);
    state.reminders = state.reminders.filter((reminder) => reminder.taskId !== taskId);
  },
  async setList(id: number, listId: number | null): Promise<void> {
    const task = state.tasks.find((item) => item.id === parseTaskId(id));
    if (!task) throw new Error("任务不存在");
    if (listId !== null && !state.lists.some((list) => list.id === parseListId(listId))) throw new Error("清单不存在");
    task.listId = listId; task.updatedAt = stamp();
  },
};

export const browserListRepository = {
  async list(): Promise<TaskList[]> { return [...state.lists].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id); },
  async create(name: string): Promise<TaskList> {
    const now = stamp(); const list: TaskList = { id: state.nextList++, name: parseListName(name), sortOrder: state.lists.length, createdAt: now, updatedAt: now };
    state.lists.push(list); return list;
  },
  async rename(id: number, name: string): Promise<void> {
    const list = state.lists.find((item) => item.id === parseListId(id)); if (!list) throw new Error("清单不存在");
    list.name = parseListName(name); list.updatedAt = stamp();
  },
  async delete(id: number): Promise<void> {
    const listId = parseListId(id), index = state.lists.findIndex((item) => item.id === listId); if (index < 0) throw new Error("清单不存在");
    state.lists.splice(index, 1);
    for (const task of state.tasks) if (task.listId === listId) task.listId = null;
  },
};

export const browserTagRepository = {
  async list(): Promise<Tag[]> { return [...state.tags].sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.id - b.id); },
  async listTaskTags(): Promise<TaskTag[]> { return [...state.taskTags]; },
  async create(name: string): Promise<Tag> {
    const parsed = parseTagName(name);
    if (state.tags.some((tag) => tag.name.toLocaleLowerCase() === parsed.toLocaleLowerCase())) throw new TagConflictError(parsed);
    const now = stamp(); const tag: Tag = { id: state.nextTag++, name: parsed, createdAt: now, updatedAt: now };
    state.tags.push(tag); return tag;
  },
  async assign(taskId: number, tagId: number): Promise<void> {
    const task = parseTaskId(taskId), tag = parseTagId(tagId);
    if (!state.tasks.some((item) => item.id === task) || !state.tags.some((item) => item.id === tag)) throw new Error("任务或标签不存在");
    if (!state.taskTags.some((link) => link.taskId === task && link.tagId === tag)) state.taskTags.push({ taskId: task, tagId: tag });
  },
  async remove(taskId: number, tagId: number): Promise<void> {
    const task = parseTaskId(taskId), tag = parseTagId(tagId), index = state.taskTags.findIndex((link) => link.taskId === task && link.tagId === tag);
    if (index < 0) throw new Error("标签关联不存在"); state.taskTags.splice(index, 1);
  },
  async delete(id: number): Promise<void> {
    const tag = parseTagId(id), index = state.tags.findIndex((item) => item.id === tag); if (index < 0) throw new Error("标签不存在");
    state.tags.splice(index, 1); state.taskTags = state.taskTags.filter((link) => link.tagId !== tag);
  },
};

export const browserReminderRepository = {
  async list(taskId: number): Promise<Reminder[]> { return state.reminders.filter((reminder) => reminder.taskId === parseTaskId(taskId)).sort((a, b) => a.remindAt.localeCompare(b.remindAt) || a.id - b.id); },
  async create(taskId: number, remindAt: string): Promise<number> {
    const id = parseTaskId(taskId); if (!state.tasks.some((task) => task.id === id)) throw new Error("任务不存在");
    const reminder: Reminder = { id: state.nextReminder++, taskId: id, remindAt: futureTime(remindAt), triggeredAt: null };
    state.reminders.push(reminder); return reminder.id;
  },
  async edit(id: number, remindAt: string): Promise<void> {
    const reminder = state.reminders.find((item) => item.id === parseTaskId(id)); if (!reminder) throw new Error("提醒不存在");
    reminder.remindAt = futureTime(remindAt);
  },
  async delete(id: number): Promise<void> {
    const index = state.reminders.findIndex((item) => item.id === parseTaskId(id)); if (index < 0) throw new Error("提醒不存在");
    state.reminders.splice(index, 1);
  },
};
