// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalQueryClient } from "@/app/queryClient";
import { listRepository } from "@/data/repositories/ListRepository";
import { tagRepository } from "@/data/repositories/TagRepository";
import { taskRepository } from "@/data/repositories/TaskRepository";
import { TagConflictError, type Tag, type TaskTag } from "@/domain/tag";
import type { Task } from "@/domain/task";
import { ListsWorkspace } from "@/features/lists/ListsWorkspace";
import { taskKeys } from "@/features/tasks/queryKeys";
import { tagKeys } from "./queryKeys";

vi.mock("@/data/repositories/ListRepository", () => ({ listRepository: { list: vi.fn() } }));
vi.mock("@/data/repositories/TagRepository", () => ({ tagRepository: { list: vi.fn(), listTaskTags: vi.fn(), create: vi.fn(), assign: vi.fn(), remove: vi.fn(), delete: vi.fn() } }));
vi.mock("@/data/repositories/TaskRepository", () => ({ taskRepository: { list: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), delete: vi.fn(), setList: vi.fn(), getById: vi.fn(), update: vi.fn() } }));
const time = "2026-10-04T00:00:00.000Z";
const tag: Tag = { id: 2, name: "Work", createdAt: time, updatedAt: time };
const task: Task = { id: 1, listId: null, title: "Inbox tagged", notes: "", status: "todo", dueAt: null, completedAt: null, sortOrder: 0, createdAt: time, updatedAt: time };
let tags: Tag[];
let links: TaskTag[];
let tasks: Task[];
const clients: ReturnType<typeof createLocalQueryClient>[] = [];
function setup() {
  const client = createLocalQueryClient(); clients.push(client);
  render(<QueryClientProvider client={client}><ListsWorkspace /></QueryClientProvider>);
  return client;
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
async function ready() { await screen.findByText("Inbox tagged"); }
function openTags() { fireEvent.click(screen.getByRole("button", { name: "打开标签" })); }
function openCreateTag() { fireEvent.click(screen.getByRole("button", { name: "新建标签" })); }
async function edit(title = "Inbox tagged") { fireEvent.click(screen.getByRole("button", { name: `编辑任务：${title}` })); await screen.findByLabelText(`分配标签：${title}`); }
async function closeDetail() { fireEvent.click(screen.getByRole("button", { name: "关闭任务详情" })); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); }
beforeEach(() => {
  vi.resetAllMocks(); onlineManager.setOnline(true);
  tags = [tag]; links = [{ taskId: 1, tagId: 2 }];
  tasks = [task, { ...task, id: 2, listId: 1, title: "List tagged" }, { ...task, id: 3, title: "Unrelated" }];
  vi.mocked(taskRepository.getById).mockImplementation(async id => tasks.find(item => item.id === id) ?? null);
  vi.mocked(listRepository.list).mockResolvedValue([{ id: 1, name: "工作", sortOrder: 0, createdAt: time, updatedAt: time }]);
  vi.mocked(tagRepository.list).mockImplementation(async () => [...tags]);
  vi.mocked(tagRepository.listTaskTags).mockImplementation(async () => [...links]);
  vi.mocked(taskRepository.list).mockImplementation(async (filters = {}) => tasks.filter((item) =>
    (filters.listId === undefined || item.listId === filters.listId) && (filters.tagId === undefined || links.some((link) => link.taskId === item.id && link.tagId === filters.tagId))));
  vi.mocked(tagRepository.create).mockImplementation(async (name) => { if (tags.some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new TagConflictError(name); const created = { ...tag, id: 4, name }; tags = [...tags, created]; return created; });
  vi.mocked(tagRepository.assign).mockImplementation(async (taskId, tagId) => { if (!links.some((link) => link.taskId === taskId && link.tagId === tagId)) links = [...links, { taskId, tagId }]; });
  vi.mocked(tagRepository.remove).mockImplementation(async (taskId, tagId) => { links = links.filter((link) => link.taskId !== taskId || link.tagId !== tagId); });
  vi.mocked(tagRepository.delete).mockImplementation(async (id) => { tags = tags.filter((item) => item.id !== id); links = links.filter((link) => link.tagId !== id); });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); onlineManager.setOnline(true); });

it("validates names, ignores IME Enter, creates trimmed Chinese names and preserves conflict input", async () => {
  setup(); await ready(); openTags(); openCreateTag();
  change("新标签名称", "  "); fireEvent.submit(screen.getByRole("form", { name: "创建标签" }));
  await screen.findByText("标签名称长度必须为 1 至 100 个字符"); expect(tagRepository.create).not.toHaveBeenCalled();
  change("新标签名称", "  家庭  ");
  const input = screen.getByLabelText("新标签名称"); fireEvent.compositionStart(input);
  expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 })).toBe(false);
  fireEvent.submit(screen.getByRole("form", { name: "创建标签" })); expect(tagRepository.create).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input); fireEvent.submit(screen.getByRole("form", { name: "创建标签" }));
  await screen.findByRole("button", { name: "打开标签：家庭" });
  expect(tagRepository.create).toHaveBeenCalledWith("家庭");
  await waitFor(() => expect(screen.queryByRole("form", { name: "创建标签" })).toBeNull());
  openCreateTag();
  change("新标签名称", "work"); fireEvent.submit(screen.getByRole("form", { name: "创建标签" }));
  await screen.findByText("标签名称已存在，请使用其他名称。");
  expect((screen.getByLabelText("新标签名称") as HTMLInputElement).value).toBe("work");
});

it("assigns a duplicate once, removes only the relation and invalidates all relevant caches offline", async () => {
  onlineManager.setOnline(false);
  const client = setup(); await ready(); await edit();
  client.setQueryData(taskKeys.detail(1), task); client.setQueryData(taskKeys.counts(), 3);
  const inactive = taskKeys.list({ view: "tag", tagId: 9 }); client.setQueryData(inactive, []);
  change("分配标签：Inbox tagged", "2"); fireEvent.click(screen.getByRole("button", { name: "分配所选标签：Inbox tagged" }));
  await waitFor(() => expect((screen.getByLabelText("分配标签：Inbox tagged") as HTMLSelectElement).value).toBe(""));
  expect(links).toEqual([{ taskId: 1, tagId: 2 }]);
  expect(taskRepository.getById).toHaveBeenCalledWith(1);
  expect(client.getQueryState(taskKeys.counts())?.isInvalidated).toBe(true);
  expect(client.getQueryState(inactive)?.isInvalidated).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "移除标签：Inbox tagged：Work" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "移除标签：Inbox tagged：Work" })).toBeNull());
  expect(screen.getByRole("heading", { name: "Inbox tagged" })).toBeTruthy(); expect(tasks).toHaveLength(3);
  expect(client.getQueryData(tagKeys.taskTags())).toEqual([]);
});

it("queries tag tasks across lists, updates the view on removal and preserves tasks on tag deletion", async () => {
  links = [...links, { taskId: 2, tagId: 2 }];
  setup(); await ready(); openTags();
  fireEvent.click(screen.getByRole("button", { name: "打开标签：Work" }));
  await screen.findByText("List tagged"); expect(screen.queryByText("Unrelated")).toBeNull();
  expect(taskRepository.list).toHaveBeenCalledWith({ tagId: 2 });
  expect(screen.queryByLabelText("新任务")).toBeNull();
  await edit(); fireEvent.click(screen.getByRole("button", { name: "移除标签：Inbox tagged：Work" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "移除标签：Inbox tagged：Work" })).toBeNull());
  await closeDetail();
  await waitFor(() => expect(screen.queryByText("Inbox tagged")).toBeNull());
  expect(screen.getByText("List tagged")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "删除标签：Work" }));
  expect(screen.getByText("删除标签“Work”？关联会被移除，任务不会被删除。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取消删除标签" })); expect(tagRepository.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "删除标签：Work" })); fireEvent.click(screen.getByRole("button", { name: "确认删除标签：Work" }));
  await screen.findByRole("heading", { name: "标签", level: 1 });
  fireEvent.click(screen.getByRole("button", { name: "打开收件箱" })); await screen.findByText("Inbox tagged");
  expect(tasks).toHaveLength(3); expect(links).toEqual([]); expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
});

it("prevents duplicate pending submits and keeps data/drafts on create, assign, remove and delete errors", async () => {
  const client = setup(); await ready(); openTags(); openCreateTag();
  client.setQueryData(taskKeys.counts(), 3);
  let reject!: (error: Error) => void;
  vi.mocked(tagRepository.create).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  change("新标签名称", "Draft"); const form = screen.getByRole("form", { name: "创建标签" }); fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => expect(tagRepository.create).toHaveBeenCalledTimes(1));
  await act(async () => { reject(new Error("locked")); });
  await screen.findByText("创建标签失败，输入已保留。请重试。"); expect((screen.getByLabelText("新标签名称") as HTMLInputElement).value).toBe("Draft");
  expect(client.getQueryState(taskKeys.counts())?.isInvalidated).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "打开收件箱" })); await edit("Unrelated");
  vi.mocked(tagRepository.assign).mockRejectedValue(new Error("locked")); change("分配标签：Unrelated", "2");
  fireEvent.click(screen.getByRole("button", { name: "分配所选标签：Unrelated" })); fireEvent.click(screen.getByRole("button", { name: "分配所选标签：Unrelated" }));
  await screen.findByText("分配标签失败，请重试。"); expect(tagRepository.assign).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "移除标签：Unrelated：Work" })).toBeNull();
  await closeDetail(); await edit();
  vi.mocked(tagRepository.remove).mockRejectedValue(new Error("locked")); fireEvent.click(screen.getByRole("button", { name: "移除标签：Inbox tagged：Work" }));
  await screen.findByText("移除标签失败，请重试。"); expect(screen.getByRole("button", { name: "移除标签：Inbox tagged：Work" })).toBeTruthy();
  await closeDetail(); openTags();
  vi.mocked(tagRepository.delete).mockRejectedValue(new Error("locked")); fireEvent.click(screen.getByRole("button", { name: "删除标签：Work" })); fireEvent.click(screen.getByRole("button", { name: "确认删除标签：Work" }));
  await screen.findByText("删除标签失败，标签和关联仍保留。请重试。"); expect(screen.getByRole("button", { name: "打开标签：Work" })).toBeTruthy(); expect(links).toHaveLength(1);
});

it("reports metadata/relationship read errors and disables assignment", async () => {
  vi.mocked(tagRepository.list).mockRejectedValue(new Error("read failed"));
  vi.mocked(tagRepository.listTaskTags).mockRejectedValue(new Error("read failed"));
  setup(); await ready(); openTags(); openCreateTag();
  await screen.findByText("标签读取失败。");
  fireEvent.click(screen.getByRole("button", { name: "打开收件箱" })); await screen.findByText("任务标签读取失败。");
  expect(screen.queryByLabelText("分配标签：Inbox tagged")).toBeNull();
  expect((screen.getByLabelText("新标签名称") as HTMLInputElement).disabled).toBe(true);
});
