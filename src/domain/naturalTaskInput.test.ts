import { describe, expect, it } from "vitest";
import { parseNaturalTaskInput } from "./naturalTaskInput";

const now = new Date(2026, 9, 5, 9, 0); // Monday, local time

describe("natural task input", () => {
  it.each([
    ["明天下午3点开会", "开会", 6, 15, 0],
    ["周五 9:30 交周报", "交周报", 9, 9, 30],
    ["下周二 18:00 健身", "健身", 13, 18, 0],
    ["10月8日 买票", "买票", 8, 12, 0],
    ["2026-11-02 20:15 交报告", "交报告", 2, 20, 15],
    ["tomorrow 4pm call", "call", 6, 16, 0],
    ["下午3点开会", "开会", 5, 15, 0],
  ])("extracts %s", (input, title, day, hour, minute) => {
    const result = parseNaturalTaskInput(input, now);
    const date = new Date(result.dueAt!);
    expect(result.title).toBe(title);
    expect(date.getDate()).toBe(day);
    expect(date.getHours()).toBe(hour);
    expect(date.getMinutes()).toBe(minute);
  });

  it("recognizes recurring tasks and keeps unsupported or invalid text", () => {
    expect(parseNaturalTaskInput("每天写日记", now)).toMatchObject({ repeatRule: "day:1", repeatText: "每天", title: "写日记" });
    expect(parseNaturalTaskInput("每周二 18:00 健身", now)).toMatchObject({ dueAt: null, repeatRule: null, title: "每周二 18:00 健身" });
    expect(parseNaturalTaskInput("2026-02-30 交报告", now).dueAt).toBeNull();
    expect(parseNaturalTaskInput("2026-02-30 交报告", now).title).toBe("2026-02-30 交报告");
  });

  it("recognizes a date-only phrase while leaving its title empty for validation", () => {
    expect(parseNaturalTaskInput("明天", now).dueAt).not.toBeNull();
    expect(parseNaturalTaskInput("明天", now).title).toBe("");
  });
  it.each([
    ["后天", 7, 12, 0], ["周一", 5, 12, 0], ["3月", 1, 12, 0],
    ["3月6日", 6, 12, 0], ["三月六日", 6, 12, 0], ["9点", 6, 9, 0], ["九点", 6, 9, 0], ["9点半", 5, 9, 30], ["九点半", 5, 9, 30],
    ["早上", 6, 7, 0], ["上午", 6, 9, 0], ["中午", 5, 12, 0],
    ["下午", 5, 13, 0], ["傍晚", 5, 17, 0], ["晚上", 5, 20, 0],
  ])("recognizes %s", (phrase, day, hour, minute) => {
    const result = parseNaturalTaskInput(`${phrase} 测试`, now);
    const date = new Date(result.dueAt!);
    expect(date.getDate()).toBe(day);
    expect(date.getHours()).toBe(hour);
    expect(date.getMinutes()).toBe(minute);
  });
  it.each([
    ["每2天", "day:2"], ["每2周", "week:2"], ["每2月", "month:2"],
    ["每周", "week-monday"], ["每年3月", "year-date:3:1"],
    ["每个3月", "year-date:3:1"],
    ["每年3月6日", "year-date:3:6"], ["每个工作日", "weekday"],
    ["每周末重复", "weekend"], ["每月第1天", "month-day:1"],
    ["每月最后1天", "month-last"], ["每月最1天", "month-last"],
  ])("persists %s as %s", (phrase, rule) => {
    const result = parseNaturalTaskInput(`${phrase} 测试`, now);
    expect(result).toMatchObject({ title: "测试", repeatRule: rule });
    expect(result.dueAt).not.toBeNull();
  });
  it("calculates advance and relative reminders from the input time", () => {
    const advanced = parseNaturalTaskInput("今天下午3点开会，提前3分钟提醒", now);
    expect(advanced.title).toBe("开会");
    expect(advanced.remindAt[0]).toBe(advanced.dueAt);
    expect(Date.parse(advanced.dueAt!) - Date.parse(advanced.remindAt[1])).toBe(3 * 60000);
    expect(parseNaturalTaskInput("今天下午3点开会，提前提醒我", now).reminderOffsets).toEqual([0, 5]);
    const relative = parseNaturalTaskInput("1小时30分钟后开会", now);
    expect(relative.remindAt).toEqual([relative.dueAt]);
    expect(Date.parse(relative.dueAt!) - now.getTime()).toBe(90 * 60000);
  });
  it.each([
    ["分钟", 3], ["小时", 180], ["天", 4320], ["周", 30240],
  ])("uses a 3 %s advance reminder", (unit, minutes) => {
    const result = parseNaturalTaskInput(`明天下午3点开会，提前3${unit}提醒`, now);
    expect(result.reminderOffsets).toEqual([0, minutes]);
    expect(Date.parse(result.dueAt!) - Date.parse(result.remindAt[1])).toBe(minutes * 60000);
  });
  it.each([
    ["分钟", 5], ["小时", 300], ["天", 7200], ["周", 50400],
  ])("schedules 5 %s later", (unit, minutes) => {
    const result = parseNaturalTaskInput(`5${unit}后开会`, now);
    expect(result.title).toBe("开会");
    expect(result.remindAt).toEqual([result.dueAt]);
    expect(Date.parse(result.dueAt!) - now.getTime()).toBe(minutes * 60000);
  });
  it("handles calendar relative reminders across month and year boundaries", () => {
    const month = parseNaturalTaskInput("1个月后缴费", new Date(2026, 0, 31, 9));
    expect(new Date(month.dueAt!).getDate()).toBe(28);
    expect(month.remindAt).toEqual([month.dueAt]);
    const year = parseNaturalTaskInput("1年后续订", new Date(2024, 1, 29, 9));
    expect(new Date(year.dueAt!).getDate()).toBe(28);
  });
  it.each(["5分钟之后", "5分钟以后", "5分后"])("recognizes alternative relative wording %s", phrase => {
    expect(Date.parse(parseNaturalTaskInput(`${phrase}测试`, now).dueAt!) - now.getTime()).toBe(5 * 60000);
  });
  it.each(["1小时30分钟之后", "1小时30分钟以后", "1小时30分后"])("recognizes mixed relative wording %s", phrase => {
    expect(Date.parse(parseNaturalTaskInput(`${phrase}测试`, now).dueAt!) - now.getTime()).toBe(90 * 60000);
  });
});
