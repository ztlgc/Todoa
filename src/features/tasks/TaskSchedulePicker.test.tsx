// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskSchedulePicker } from "./TaskSchedulePicker";
import type { Task } from "@/domain/task";
afterEach(cleanup);
const task: Task = {
  id: 1,
  title: "任务",
  notes: "",
  listId: null,
  status: "todo",
  dueAt: null,
  completedAt: null,
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
};
it("allows reminder drafts without a time and saves hour/day offsets after the time is supplied", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<TaskSchedulePicker task={task} onSave={save} onClosed={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "无时间" }));
  expect(screen.queryByRole("checkbox", { name: "提前10分钟" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "提前30分钟" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "提前1天" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "提前3天" }));
  fireEvent.change(screen.getByLabelText("自定义提前数量"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  expect(screen.getByRole("button", { name: "提前2小时 ×" })).toBeTruthy();
  fireEvent.click(screen.getByRole("combobox", { name: "自定义提醒单位" }));
  await chooseOption("天");
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  expect(screen.getByRole("button", { name: "提前2天 ×" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "确定" }));
  await screen.findByText("请先选择日期。");
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "下周" }));
  fireEvent.click(screen.getByRole("button", { name: "确定" }));
  await screen.findByText("设置提醒前，请明确选择时间。");
  fireEvent.click(screen.getByRole("button", { name: "截止时间" }));
  fireEvent.click(screen.getByRole("button", { name: "21时" }));
  fireEvent.click(screen.getByRole("button", { name: "30分" }));
  fireEvent.click(screen.getByRole("button", { name: "应用时间" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择时间" })).toBeNull());
  expect(screen.getByRole("button", { name: "截止时间" }).textContent).toContain("21:30");
  fireEvent.click(screen.getByRole("button", { name: "确定" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ reminderOffsets: [1440, 4320, 120, 2880] }),
    ),
  );
});
it("shows custom repetition only in its dialog and applies or cancels without saving the task", async () => {
  const save = vi.fn();
  render(<TaskSchedulePicker task={task} onSave={save} onClosed={() => {}} />);
  expect(screen.queryByLabelText("重复间隔")).toBeNull();
  fireEvent.click(screen.getByRole("combobox", { name: "重复规则" }));
  await chooseOption("自定义重复…");
  fireEvent.change(screen.getByLabelText("重复间隔"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("重复单位"), {
    target: { value: "week" },
  });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByLabelText("重复间隔")).toBeNull());
  expect(screen.getByRole("combobox", { name: "重复规则" }).textContent).toContain("不重复");
  fireEvent.click(screen.getByRole("combobox", { name: "重复规则" }));
  await chooseOption("自定义重复…");
  fireEvent.change(screen.getByLabelText("重复间隔"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("重复单位"), {
    target: { value: "week" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用重复" }));
  await waitFor(() => expect(screen.queryByLabelText("重复间隔")).toBeNull());
  expect(screen.getByRole("combobox", { name: "重复规则" }).textContent).toContain("每2周");
  expect(save).not.toHaveBeenCalled();
});
it("discards cancelled time changes and clears time together with reminders", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<TaskSchedulePicker task={{ ...task, dueDate: "2099-10-08" }} onSave={save} onClosed={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "截止时间" }));
  fireEvent.click(screen.getByRole("button", { name: "23时" }));
  fireEvent.click(screen.getByRole("button", { name: "59分" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择时间" })).toBeNull());
  expect(screen.getByRole("button", { name: "截止时间" }).textContent).toContain("09:00");
  fireEvent.click(screen.getByRole("button", { name: "截止时间" }));
  expect(screen.getByRole("button", { name: "09时" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "00分" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "应用时间" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择时间" })).toBeNull());
  fireEvent.click(screen.getByRole("checkbox", { name: "准时" }));
  fireEvent.click(screen.getByRole("button", { name: "无时间" }));
  fireEvent.click(screen.getByRole("button", { name: "确定" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ dueAt: null, dueDate: "2099-10-08", reminderOffsets: [] })));
});

it("defaults a new schedule to 09:00 and preserves existing exact times", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<TaskSchedulePicker task={task} onSave={save} onClosed={() => {}} />);
  expect(screen.getByRole("button", { name: "截止时间" }).textContent).toContain("09:00");
  fireEvent.click(screen.getByRole("button", { name: "下周" }));
  fireEvent.click(screen.getByRole("combobox", { name: "重复规则" }));
  await chooseOption("每天");
  expect(screen.getByRole("combobox", { name: "重复规则" }).textContent).toContain("每天");
  fireEvent.click(screen.getByRole("button", { name: "确定" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const input = save.mock.calls[0][0];
  const due = new Date(input.dueAt);
  expect(due.getHours()).toBe(9);
  expect(due.getMinutes()).toBe(0);
  expect(input.repeatRule).toBe("day:1");
});

async function chooseOption(name: string) {
  const option = await screen.findByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
}
