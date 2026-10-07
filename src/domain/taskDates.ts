import { parseTaskTime, TaskValidationError, type Task } from "./task";

export function compareTaskDates(a: Task, b: Task) {
  const time = (task: Task) => task.dueDate ? new Date(`${task.dueDate}T00:00:00`).getTime() : task.dueAt ? Date.parse(task.dueAt) : Infinity;
  return time(a) - time(b) || a.sortOrder - b.sortOrder || a.id - b.id;
}

export function localDayRange(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new TaskValidationError("系统时间无效");
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}
const pad = (value: number, digits = 2) => String(value).padStart(digits, "0");
export function toLocalInput(utc: string | null): string {
  if (utc === null) return "";
  const date = new Date(parseTaskTime(utc));
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) throw new TaskValidationError("请选择本地日期与时间");
  const [, y, m, d, h, min, sec = "0", ms = "0"] = match;
  const parts = [Number(y), Number(m)-1, Number(d), Number(h), Number(min), Number(sec), Number(ms.padEnd(3, "0"))];
  const date = new Date(0); date.setFullYear(parts[0], parts[1], parts[2]); date.setHours(parts[3], parts[4], parts[5], parts[6]);
  const actual = [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()];
  if (actual.some((part, index) => part !== parts[index])) throw new TaskValidationError("本地日期不存在，可能位于夏令时跳跃时段");
  return parseTaskTime(date.toISOString());
}
