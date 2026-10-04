// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalQueryClient } from "@/app/queryClient";
import { taskRepository } from "@/data/repositories/TaskRepository";
import type { Task } from "@/domain/task";
import { TaskDetails } from "./TaskDetails";

vi.mock("@/data/repositories/TaskRepository", () => ({ taskRepository: { getById: vi.fn(), update: vi.fn() } }));
vi.mock("@/features/tags/TaskTags", () => ({ TaskTags: () => <p>标签入口</p> }));
vi.mock("@/features/reminders/TaskReminders", () => ({ TaskReminders: () => <p>提醒入口</p> }));
const task: Task = { id: 1, listId: null, title: "原始标题", notes: "原始备注", dueAt: null, status: "todo", completedAt: null, sortOrder: 0, createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z" };
let client: ReturnType<typeof createLocalQueryClient>;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(taskRepository.getById).mockResolvedValue(task); client = createLocalQueryClient(); });
afterEach(() => { cleanup(); client.clear(); document.querySelectorAll("[data-test-return]").forEach(element => element.remove()); });
function setup() {
  const returnTo = document.createElement("button"); returnTo.textContent = "返回任务"; returnTo.dataset.testReturn = "true"; document.body.append(returnTo);
  const closed = vi.fn();
  render(<QueryClientProvider client={client}><TaskDetails id={1} lists={[]} listsUnavailable={false} taskTags={[]} tags={[]} tagsUnavailable={false} returnTo={returnTo} onClosed={closed} /></QueryClientProvider>);
  return { returnTo, closed };
}
it("preserves drafts on failure/refetch, guards IME and duplicate submissions, traps/returns focus", async () => {
  const { returnTo } = setup(); const title = await screen.findByLabelText("任务标题");
  await waitFor(() => expect(document.activeElement).toBe(title));
  fireEvent.change(title, { target: { value: "中文草稿" } });
  fireEvent.change(screen.getByLabelText("备注"), { target: { value: "多行\n纯文本" } });
  fireEvent.compositionStart(title); fireEvent.submit(screen.getByRole("form", { name: "编辑任务" }));
  expect(taskRepository.update).not.toHaveBeenCalled(); fireEvent.compositionEnd(title);
  let fail!: (e: Error) => void;
  vi.mocked(taskRepository.update).mockReturnValue(new Promise((_ok, reject) => { fail = reject; }));
  fireEvent.submit(screen.getByRole("form", { name: "编辑任务" })); fireEvent.submit(screen.getByRole("form", { name: "编辑任务" }));
  await waitFor(() => expect(taskRepository.update).toHaveBeenCalledTimes(1));
  await act(async () => { fail(new Error("database locked")); });
  await screen.findByText("保存失败，草稿已保留。请重试。");
  await act(async () => { await client.refetchQueries({ type: "active" }); });
  expect((title as HTMLInputElement).value).toBe("中文草稿"); expect((screen.getByLabelText("备注") as HTMLTextAreaElement).value).toBe("多行\n纯文本");
  fireEvent.click(screen.getByRole("button", { name: "关闭任务详情" }));
  await screen.findByText("放弃未保存的修改？"); fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect((title as HTMLInputElement).value).toBe("中文草稿");
  fireEvent.click(screen.getByRole("button", { name: "关闭任务详情" })); fireEvent.click(await screen.findByRole("button", { name: "放弃修改并关闭" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(returnTo));
  returnTo.remove();
});
it("saves validated task fields and list together, with explicit date clearing", async () => {
  vi.mocked(taskRepository.getById).mockResolvedValue({ ...task, dueAt: "2026-10-05T00:00:00.123Z" });
  vi.mocked(taskRepository.update).mockResolvedValue(task); setup();
  await screen.findByLabelText("任务标题"); fireEvent.click(screen.getByRole("button", { name: "清空截止时间" }));
  fireEvent.change(screen.getByLabelText("任务标题"), { target: { value: "  新标题  " } });
  fireEvent.submit(screen.getByRole("form", { name: "编辑任务" }));
  await waitFor(() => expect(taskRepository.update).toHaveBeenCalledWith(1, { title: "新标题", notes: "原始备注", dueAt: null, listId: null }));
});
