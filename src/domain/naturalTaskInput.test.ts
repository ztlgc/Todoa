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

  it("keeps unsupported recurrence and invalid dates in the title", () => {
    expect(parseNaturalTaskInput("每天写日记", now)).toMatchObject({ dueAt: null, repeatText: "每天", title: "每天写日记" });
    expect(parseNaturalTaskInput("每周二 18:00 健身", now)).toMatchObject({ dueAt: null, repeatText: "每周二", title: "每周二 18:00 健身" });
    expect(parseNaturalTaskInput("2026-02-30 交报告", now).dueAt).toBeNull();
    expect(parseNaturalTaskInput("2026-02-30 交报告", now).title).toBe("2026-02-30 交报告");
  });

  it("does not turn a date-only title into an empty task", () => {
    expect(parseNaturalTaskInput("明天", now).dueAt).toBeNull();
    expect(parseNaturalTaskInput("明天", now).title).toBe("明天");
  });
});
