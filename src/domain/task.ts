import { parseListId } from "./list";
import { parseTagId } from "./tag";

export type TaskStatus = "todo" | "completed";
export type TaskPriority = "high" | "medium" | "low" | "none";

export function parseTaskPriority(value: unknown): TaskPriority {
  if (value !== "high" && value !== "medium" && value !== "low" && value !== "none") {
    throw new TaskValidationError("任务优先级无效");
  }
  return value;
}

export interface Task {
  id: number;
  listId: number | null;
  title: string;
  notes: string;
  contentJson?: string | null;
  contentRevision?: number;
  dueDate?: string | null;
  status: TaskStatus;
  priority?: TaskPriority;
  dueAt: string | null;
  repeatRule?: string | null;
  reminderOffsets?: number[];
  completedAt: string | null;
  deletedAt?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  listId?: number | null;
  notes?: string;
  dueAt?: string | null;
  priority?: TaskPriority;
  repeatRule?: string | null;
  remindAt?: string[];
  reminderOffsets?: number[];
}

export interface UpdateTaskInput {
  repeatRule?: string | null;
  dueDate?: string | null;
  reminderOffsets?: number[];
  listId?: number | null;
  title?: string;
  notes?: string;
  dueAt?: string | null;
  priority?: TaskPriority;
}

export interface TaskFilters {
  status?: TaskStatus;
  deleted?: boolean;
  listId?: number | null;
  tagId?: number;
  dateView?: "today" | "upcoming";
  dateRange?: { from: string; to?: string };
}

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskValidationError";
  }
}

export function parseTaskId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TaskValidationError("任务 ID 必须是正安全整数");
  }
  return value;
}

export function parseTaskStatus(value: unknown): TaskStatus {
  if (value !== "todo" && value !== "completed") {
    throw new TaskValidationError("任务状态无效");
  }
  return value;
}

export function parseTaskTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new TaskValidationError("任务标题必须是文本");
  }
  if (value.includes("\0") || /[\uD800-\uDFFF]/u.test(value)) {
    throw new TaskValidationError("任务标题包含无效字符");
  }
  const title = value.trim();
  if (title.length < 1 || [...title].length > 500) {
    throw new TaskValidationError("任务标题长度必须为 1 至 500 个字符");
  }
  return title;
}

export function parseTaskNotes(value: unknown): string {
  if (typeof value !== "string" || [...value].length > 100000) {
    throw new TaskValidationError("任务备注不得超过 100000 个字符");
  }
  return value;
}

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export function parseTaskTime(value: unknown): string {
  if (typeof value !== "string") {
    throw new TaskValidationError("时间必须包含时区");
  }
  const match = DATE_TIME.exec(value);
  if (!match) {
    throw new TaskValidationError("时间必须是带时区的 ISO 8601 时刻");
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, , sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText ? Number(offsetHourText) : 0;
  const offsetMinute = offsetMinuteText ? Number(offsetMinuteText) : 0;
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
    throw new TaskValidationError("时间或时区偏移无效");
  }
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, Number((fraction ?? "").padEnd(3, "0")));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() + 1 !== month || local.getUTCDate() !== day) {
    throw new TaskValidationError("日期无效");
  }
  const offset = (offsetHour * 60 + offsetMinute) * 60000 * (sign === "-" ? -1 : 1);
  const utc = new Date(local.getTime() - offset);
  if (!Number.isFinite(utc.getTime()) || utc.getUTCFullYear() < 1 || utc.getUTCFullYear() > 9999) {
    throw new TaskValidationError("时间超出可存储范围");
  }
  return utc.toISOString();
}

export function parseCreateTaskInput(value: CreateTaskInput): { title: string; notes: string; dueAt: string | null; listId: number | null; repeatRule: string | null; remindAt: string[]; reminderOffsets: number[]; priority: TaskPriority } {
  if (value === null || typeof value !== "object") {
    throw new TaskValidationError("任务输入无效");
  }
  const repeatRule = value.repeatRule ?? null;
  if (repeatRule !== null && !/^(?:day|week|month|year):[1-9]\d{0,2}$|^week-monday$|^weekday$|^weekend$|^month-last$|^month-day:(?:[1-9]|[12]\d|3[01])$|^year-date:(?:[1-9]|1[0-2]):(?:[1-9]|[12]\d|3[01])$/.test(repeatRule)) throw new TaskValidationError("重复规则无效");
  const remindAt = (value.remindAt ?? []).map(parseTaskTime);
  const reminderOffsets = value.reminderOffsets ?? [];
  if (remindAt.length > 16 || reminderOffsets.length > 16 || reminderOffsets.some(offset => !Number.isSafeInteger(offset) || offset < 0 || offset > 525600)) throw new TaskValidationError("提醒规则无效");
  if (remindAt.length !== reminderOffsets.length) throw new TaskValidationError("提醒时间与规则不一致");
  if (repeatRule && !value.dueAt) throw new TaskValidationError("重复任务需要开始时间");
  return {
    title: parseTaskTitle(value.title),
    listId: value.listId == null ? null : parseListId(value.listId),
    notes: parseTaskNotes(value.notes ?? ""),
    dueAt: value.dueAt == null ? null : parseTaskTime(value.dueAt),
    repeatRule, remindAt, reminderOffsets, priority: parseTaskPriority(value.priority ?? "none"),
  };
}

export function parseUpdateTaskInput(value: UpdateTaskInput): UpdateTaskInput {
  if (value === null || typeof value !== "object") {
    throw new TaskValidationError("任务输入无效");
  }
  const result: UpdateTaskInput = {};
  if (value.listId !== undefined) result.listId = value.listId === null ? null : parseListId(value.listId);
  if (value.title !== undefined) result.title = parseTaskTitle(value.title);
  if (value.notes !== undefined) result.notes = parseTaskNotes(value.notes);
  if (value.dueAt !== undefined) result.dueAt = value.dueAt === null ? null : parseTaskTime(value.dueAt);
  if (value.priority !== undefined) result.priority = parseTaskPriority(value.priority);
  if (value.repeatRule !== undefined) {
    if (value.repeatRule !== null) parseCreateTaskInput({ title: "验证", dueAt: "2026-01-01T00:00:00.000Z", repeatRule: value.repeatRule });
    result.repeatRule = value.repeatRule;
  }
  if (value.dueDate !== undefined) {
    if (value.dueDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate) || new Date(value.dueDate+"T12:00:00Z").toISOString().slice(0,10) !== value.dueDate)) throw new TaskValidationError("日期无效");
    result.dueDate = value.dueDate;
  }
  if (value.reminderOffsets !== undefined) {
    if (value.reminderOffsets.length > 16 || value.reminderOffsets.some(n => !Number.isSafeInteger(n) || n < 0 || n > 525600)) throw new TaskValidationError("提醒规则无效");
    result.reminderOffsets = [...new Set(value.reminderOffsets)];
  }
  if (Object.keys(result).length === 0) {
    throw new TaskValidationError("没有可更新的任务字段");
  }
  return result;
}

export function parseTaskFilters(value: TaskFilters = {}): TaskFilters {
  if (value === null || typeof value !== "object") {
    throw new TaskValidationError("任务筛选条件无效");
  }
  if (value.deleted !== undefined && typeof value.deleted !== "boolean") throw new TaskValidationError("回收站筛选条件无效");
  let date: Pick<TaskFilters, "dateView" | "dateRange"> = {};
  if (value.dateView !== undefined || value.dateRange !== undefined) {
    if ((value.dateView !== "today" && value.dateView !== "upcoming") || !value.dateRange || value.status === "completed") throw new TaskValidationError("日期视图条件无效");
    const from = parseTaskTime(value.dateRange.from);
    const to = value.dateRange.to === undefined ? undefined : parseTaskTime(value.dateRange.to);
    if ((value.dateView === "today" && (!to || to <= from)) || (value.dateView === "upcoming" && to !== undefined)) throw new TaskValidationError("日期范围无效");
    date = { dateView: value.dateView, dateRange: { from, ...(to === undefined ? {} : { to }) } };
  }
  return {
    ...(value.status === undefined ? {} : { status: parseTaskStatus(value.status) }),
    ...(value.deleted === undefined ? {} : { deleted: value.deleted }),
    ...(value.listId === undefined ? {} : { listId: value.listId === null ? null : parseListId(value.listId) }),
    ...(value.tagId === undefined ? {} : { tagId: parseTagId(value.tagId) }),
    ...date,
    ...(date.dateView ? { status: "todo" as const } : {}),
  };
}
