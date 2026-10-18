// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalQueryClient } from "@/app/queryClient";
import { taskRepository } from "@/data/repositories/TaskRepository";
import { contentRepository, plainText } from "@/data/repositories/ContentRepository";
import { readSubtasks } from "@/domain/subtask";
import type { Task } from "@/domain/task";
import { Inbox, TaskListView, TrashView } from "./Inbox";

vi.mock("@/data/repositories/TaskRepository", () => ({
  taskRepository: { list: vi.fn(), create: vi.fn(), update: vi.fn(), updateStatus: vi.fn(), trash: vi.fn(), restore: vi.fn(), delete: vi.fn(), getById: vi.fn() },
}));
vi.mock("@/data/repositories/ContentRepository", async importOriginal => ({
  ...await importOriginal<typeof import("@/data/repositories/ContentRepository")>(),
  contentRepository: { save: vi.fn() },
}));
const task: Task = {
  id: 1, listId: null, title: "Buy milk", notes: "", status: "todo",
  dueAt: null, completedAt: null, sortOrder: 0,
  createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z",
};
let rows: Task[];
const clients: ReturnType<typeof createLocalQueryClient>[] = [];

function renderInbox() {
  const client = createLocalQueryClient();
  clients.push(client);
  return render(<QueryClientProvider client={client}><Inbox /></QueryClientProvider>);
}
function input(text: string) { fireEvent.change(screen.getByLabelText("新任务"), { target: { value: text } }); }
function submit() { fireEvent.submit(screen.getByRole("form", { name: "新增任务" })); }

beforeEach(() => {
  vi.resetAllMocks();
  rows = [];
  vi.mocked(taskRepository.list).mockImplementation(async filters => rows.filter(row => !filters?.status || row.status === filters.status));
  vi.mocked(taskRepository.create).mockImplementation(async ({ title }) => {
    const created = { ...task, title };
    rows = [created];
    return created;
  });
  vi.mocked(taskRepository.updateStatus).mockImplementation(async (_id, status) => { rows = [{ ...task, status }]; });
  vi.mocked(taskRepository.update).mockImplementation(async (id, input) => { rows = rows.map(row => row.id === id ? { ...row, ...input } : row); return rows.find(row => row.id === id)!; });
  vi.mocked(taskRepository.getById).mockImplementation(async id => rows.find(row => row.id === id) ?? null);
  vi.mocked(taskRepository.delete).mockImplementation(async () => { rows = []; });
  vi.mocked(taskRepository.trash).mockImplementation(async () => { rows = []; });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

it("renders and toggles real subtask checkboxes without duplicating projected notes", async () => {
  const doc = { type: "doc", attrs: { subtasks: [
    { id: "one", title: "核对资料", completed: true, dueDate: "2026-10-20" },
    { id: "two", title: "整理纪要", completed: false },
  ] }, content: [{ type: "paragraph", content: [{ type: "text", text: "正文保留 [x] 示例" }] }] };
  rows = [{ ...task, notes: plainText(doc), contentJson: JSON.stringify(doc), contentRevision: 3 }];
  vi.mocked(contentRepository.save).mockImplementation(async (id, title, next, revision) => {
    rows = rows.map(row => row.id === id ? { ...row, title, contentJson: JSON.stringify(next), notes: plainText(next), contentRevision: revision + 1 } : row);
    return revision + 1;
  });
  renderInbox();
  const checked = await screen.findByRole("checkbox", { name: "取消完成子任务：核对资料" });
  expect(checked.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("核对资料").className).toContain("line-through");
  expect(screen.queryByText("[x] 核对资料")).toBeNull();
  expect(screen.getByText("正文保留 [x] 示例")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "完成子任务：整理纪要" }));
  await screen.findByRole("checkbox", { name: "取消完成子任务：整理纪要" });
  expect(readSubtasks(JSON.parse(rows[0].contentJson!))).toEqual([
    expect.objectContaining({ id: "one", completed: true, dueDate: "2026-10-20" }),
    expect.objectContaining({ id: "two", completed: true }),
  ]);
  expect(screen.queryByLabelText("任务标题")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "取消完成子任务：核对资料" }));
  await screen.findByRole("checkbox", { name: "完成子任务：核对资料" });
  expect(readSubtasks(JSON.parse(rows[0].contentJson!))[0].completed).toBe(false);
});

it("retains subtask state and body after a failed card toggle", async () => {
  const doc = { type: "doc", attrs: { subtasks: [{ id: "one", title: "核对资料", completed: true }] }, content: [] };
  rows = [{ ...task, contentJson: JSON.stringify(doc), notes: "[x] 核对资料" }];
  vi.mocked(contentRepository.save).mockRejectedValue(new Error("CONTENT_CONFLICT"));
  renderInbox();
  fireEvent.click(await screen.findByRole("checkbox", { name: "取消完成子任务：核对资料" }));
  await screen.findByText("子任务状态保存失败，请重试。");
  expect(screen.getByRole("checkbox", { name: "取消完成子任务：核对资料" }).getAttribute("aria-checked")).toBe("true");
  expect(rows[0].contentJson).toBe(JSON.stringify(doc));
});

it("keeps ordinary notes and readable fallback text intact", async () => {
  rows = [{ ...task, notes: "[x] 手写备注", contentJson: "{broken" }];
  renderInbox();
  await screen.findByText("[x] 手写备注");
  expect(screen.queryByRole("checkbox", { name: /子任务/ })).toBeNull();
});

it("distinguishes loading, empty and read failure", async () => {
  let loaded!: (value: Task[]) => void;
  vi.mocked(taskRepository.list).mockReturnValue(new Promise((resolve) => { loaded = resolve; }));
  renderInbox();
  expect(screen.getByRole("status").textContent).toContain("正在读取");
  expect(screen.queryByText("收件箱为空")).toBeNull();
  await act(async () => { loaded([]); });
  await screen.findByText("收件箱为空");
  cleanup();
  vi.mocked(taskRepository.list).mockRejectedValue(new Error("read failed"));
  renderInbox();
  await screen.findByText("收件箱读取失败。请重试。");
  expect(screen.queryByText("收件箱为空")).toBeNull();
});

it("rejects blank input and creates via Query before clearing the draft", async () => {
  renderInbox();
  await screen.findByText("收件箱为空");
  input("   "); submit();
  expect(screen.getByRole("alert").textContent).toContain("标题长度");
  expect(taskRepository.create).not.toHaveBeenCalled();
  input("  Buy milk  "); submit();
  await screen.findByText("Buy milk");
  expect((screen.getByLabelText("新任务") as HTMLInputElement).value).toBe("");
  expect(taskRepository.create).toHaveBeenCalledWith({ title: "Buy milk" });
  expect(taskRepository.list).toHaveBeenCalledWith({ listId: null, status: "todo" });
});

it("shows the saved priority beneath the task and colors its checkbox", async () => {
  rows = [{ ...task, priority: "high" }];
  renderInbox();
  await screen.findByText("高优先级");
  expect(screen.getByRole("checkbox", { name: "完成：Buy milk" }).className).toContain("border-red-500");
});

it("opens a priority chooser and saves the selected priority immediately", async () => {
  rows = [task];
  renderInbox();
  fireEvent.click(await screen.findByRole("button", { name: "更改优先级：无优先级" }));
  fireEvent.click(await screen.findByRole("button", { name: "高优先级" }));
  await waitFor(() => expect(taskRepository.update).toHaveBeenCalledWith(1, { priority: "high" }));
  await screen.findByRole("button", { name: "更改优先级：高优先级" });
});

it("shows the task time as text and opens details instead of a native picker", async () => {
  const dueAt = "2026-10-07T07:30:00.000Z";
  rows = [{ ...task, dueAt }];
  renderInbox();
  const time = await screen.findByText(new Date(dueAt).toLocaleString());
  expect(time.tagName).toBe("TIME");
  expect(screen.queryByLabelText("截止时间：Buy milk")).toBeNull();
  expect(screen.queryByRole("button", { name: /更改时间|设置时间/ })).toBeNull();
  fireEvent.click(time);
  await screen.findByLabelText("任务标题");
  expect(taskRepository.update).not.toHaveBeenCalled();
});

it("opens task details when clicking the task card body", async () => {
  rows = [task];
  renderInbox();
  const card = await screen.findByText("Buy milk").then(element => element.closest("li")!);
  fireEvent.click(card, { clientX: 8, clientY: 8 });
  await screen.findByLabelText("任务标题");
});

it("does not submit during IME composition", async () => {
  renderInbox();
  await screen.findByText("收件箱为空");
  input("中文任务");
  const field = screen.getByLabelText("新任务");
  fireEvent.compositionStart(field);
  expect(fireEvent.keyDown(field, { key: "Enter", isComposing: true, keyCode: 229 })).toBe(false);
  submit();
  expect(taskRepository.create).not.toHaveBeenCalled();
  fireEvent.compositionEnd(field);
  submit();
  await screen.findByText("中文任务");
  expect(taskRepository.create).toHaveBeenCalledTimes(1);
});

it("prevents duplicate pending submits and preserves draft on write failure", async () => {
  let fail!: (error: Error) => void;
  vi.mocked(taskRepository.create).mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
  renderInbox();
  await screen.findByText("收件箱为空");
  input("Keep this draft");
  submit(); submit();
  await waitFor(() => expect(taskRepository.create).toHaveBeenCalledTimes(1));
  expect((screen.getByLabelText("新任务") as HTMLInputElement).disabled).toBe(true);
  await act(async () => { fail(new Error("database locked")); });
  await screen.findByText("新增失败，输入已保留。请稍后重试。");
  expect((screen.getByLabelText("新任务") as HTMLInputElement).value).toBe("Keep this draft");
  expect(screen.queryByText("Keep this draft")).toBeNull();
});

it("moves completed tasks out of the inbox and supports undo from the completed view", async () => {
  rows = [task];
  renderInbox();
  await screen.findByText("Buy milk");
  fireEvent.click(screen.getByRole("checkbox", { name: "完成：Buy milk" }));
  await screen.findByText("收件箱为空");
  expect(screen.queryByText("Buy milk")).toBeNull();
  cleanup();
  const client = createLocalQueryClient(); clients.push(client);
  render(<QueryClientProvider client={client}><TaskListView name="已完成" dateFilters={{ status: "completed" }} /></QueryClientProvider>);
  await screen.findByText("Buy milk");
  fireEvent.click(screen.getByRole("checkbox", { name: "取消完成：Buy milk" }));
  await screen.findByText("已完成为空");
  expect(screen.queryByText("Buy milk")).toBeNull();
  cleanup();
  renderInbox();
  await screen.findByText("Buy milk");
  fireEvent.click(screen.getByRole("button", { name: "移入回收站：Buy milk" }));
  await screen.findByText("收件箱为空");
  expect(taskRepository.trash).toHaveBeenCalledWith(1);
  expect(taskRepository.delete).not.toHaveBeenCalled();
});

it("retains the task and current status after status/delete failures", async () => {
  rows = [task];
  vi.mocked(taskRepository.updateStatus).mockRejectedValue(new Error("write failed"));
  vi.mocked(taskRepository.trash).mockRejectedValue(new Error("write failed"));
  renderInbox();
  await screen.findByText("Buy milk");
  fireEvent.click(screen.getByRole("checkbox", { name: "完成：Buy milk" }));
  await screen.findByText("状态更改失败，请重试。");
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "移入回收站：Buy milk" }));
  await screen.findByText("删除失败，任务仍保留，请重试。");
  expect(screen.getByText("Buy milk")).toBeTruthy();
});

it("restores trashed tasks and confirms permanent deletion only in the trash", async () => {
  let discarded = [{ ...task, deletedAt: "2026-10-05T00:00:00.000Z" }];
  vi.mocked(taskRepository.list).mockImplementation(async filters => filters?.deleted ? [...discarded] : []);
  vi.mocked(taskRepository.restore).mockImplementation(async () => { discarded = []; });
  vi.mocked(taskRepository.delete).mockImplementation(async () => { discarded = []; });
  const client = createLocalQueryClient(); clients.push(client);
  render(<QueryClientProvider client={client}><TrashView /></QueryClientProvider>);
  await screen.findByText("Buy milk");
  fireEvent.click(screen.getByRole("button", { name: "恢复" }));
  await screen.findByText("回收站为空");
  expect(taskRepository.restore).toHaveBeenCalledWith(1);
  discarded = [{ ...task, deletedAt: "2026-10-05T00:00:00.000Z" }];
  await act(async () => { await client.invalidateQueries(); });
  await screen.findByText("Buy milk");
  fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
  expect(taskRepository.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(taskRepository.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
  fireEvent.click(screen.getByRole("button", { name: "确认永久删除" }));
  await screen.findByText("回收站为空");
  expect(taskRepository.delete).toHaveBeenCalledWith(1);
});
