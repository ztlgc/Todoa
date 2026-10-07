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
vi.mock("@/features/reminders/TaskReminders", () => ({
  TaskReminders: () => null,
}));
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
  expect(screen.queryByRole("checkbox", { name: "提前10分钟" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "提前30分钟" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "提前1天" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "提前3天" }));
  fireEvent.change(screen.getByLabelText("自定义提前数量"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  expect(screen.getByRole("button", { name: "提前2小时 ×" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("自定义提醒单位"), {
    target: { value: "day" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  expect(screen.getByRole("button", { name: "提前2天 ×" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "确定" }));
  await screen.findByText("请先选择日期。");
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "下周" }));
  fireEvent.click(screen.getByRole("button", { name: "确定" }));
  await screen.findByText("设置提醒前，请明确选择时间。");
  fireEvent.input(screen.getByLabelText("截止时间"), {
    target: { value: "21:30" },
  });
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
  fireEvent.change(screen.getByLabelText("重复规则"), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByLabelText("重复间隔"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("重复单位"), {
    target: { value: "week" },
  });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByLabelText("重复间隔")).toBeNull());
  expect((screen.getByLabelText("重复规则") as HTMLSelectElement).value).toBe(
    "",
  );
  fireEvent.change(screen.getByLabelText("重复规则"), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByLabelText("重复间隔"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("重复单位"), {
    target: { value: "week" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用重复" }));
  await waitFor(() => expect(screen.queryByLabelText("重复间隔")).toBeNull());
  expect((screen.getByLabelText("重复规则") as HTMLSelectElement).value).toBe(
    "week:2",
  );
  expect(save).not.toHaveBeenCalled();
});
