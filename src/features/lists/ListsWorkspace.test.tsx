// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalQueryClient } from "@/app/queryClient";
import { listRepository } from "@/data/repositories/ListRepository";
import { contentRepository } from "@/data/repositories/ContentRepository";
import { taskRepository } from "@/data/repositories/TaskRepository";
import type { TaskList } from "@/domain/list";
import type { Task } from "@/domain/task";
import { taskKeys } from "@/features/tasks/queryKeys";
import { ListsWorkspace } from "./ListsWorkspace";
import { listKeys } from "./queryKeys";

vi.mock("@/data/repositories/ListRepository", () => ({ listRepository: { list: vi.fn(), create: vi.fn(), rename: vi.fn(), delete: vi.fn() } }));
vi.mock("@/data/repositories/TaskRepository", () => ({ taskRepository: { list: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), delete: vi.fn(), setList: vi.fn(), getById: vi.fn(), update: vi.fn() } }));
vi.mock("@/data/repositories/TagRepository", () => ({ tagRepository: { list: async () => [], listTaskTags: async () => [] } }));
vi.mock("@/data/repositories/ContentRepository", () => ({ contentRepository: { save: vi.fn() }, plainDocument: (text:string)=>({ type:"doc", content:[{type:"paragraph",content:text?[{type:"text",text}]:[]}] }) }));
const time = "2026-10-04T00:00:00.000Z";
const list: TaskList = { id: 1, name: "工作", sortOrder: 0, createdAt: time, updatedAt: time };
const task: Task = { id: 1, listId: 1, title: "Work task", notes: "", status: "todo", dueAt: null, completedAt: null, sortOrder: 0, createdAt: time, updatedAt: time };
let lists: TaskList[];
let tasks: Task[];
const clients: ReturnType<typeof createLocalQueryClient>[] = [];
function setup() {
  const client = createLocalQueryClient(); clients.push(client);
  render(<QueryClientProvider client={client}><ListsWorkspace /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "打开清单" }));
  return client;
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function openCreateList() { fireEvent.click(screen.getByRole("button", { name: "新建清单" })); }
function openListManagement(name: string) { fireEvent.click(screen.getByRole("button", { name: `管理清单：${name}` })); }
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); vi.mocked(contentRepository.save).mockResolvedValue(1); onlineManager.setOnline(true);
  lists = [list]; tasks = [task];
  vi.mocked(listRepository.list).mockImplementation(async () => [...lists]);
  vi.mocked(listRepository.create).mockImplementation(async (name) => { const created = { ...list, id: 2, name }; lists = [...lists, created]; return created; });
  vi.mocked(listRepository.rename).mockImplementation(async (id, name) => { lists = lists.map((item) => item.id === id ? { ...item, name } : item); });
  vi.mocked(listRepository.delete).mockImplementation(async (id) => { lists = lists.filter((item) => item.id !== id); tasks = tasks.map((item) => item.listId === id ? { ...item, listId: null } : item); });
  vi.mocked(taskRepository.list).mockImplementation(async (filters) => filters?.listId === undefined ? [...tasks] : tasks.filter((item) => item.listId === filters.listId));
  vi.mocked(taskRepository.create).mockImplementation(async (input) => { const created = { ...task, id: 2, title: input.title, listId: input.listId ?? null }; tasks = [...tasks, created]; return created; });
  vi.mocked(taskRepository.getById).mockImplementation(async id => tasks.find(item => item.id === id) ?? null);
  vi.mocked(taskRepository.update).mockImplementation(async (id, input) => { tasks = tasks.map(item => item.id === id ? { ...item, ...input } : item); return tasks.find(item => item.id === id)!; });
  vi.mocked(taskRepository.setList).mockImplementation(async (id, listId) => { tasks = tasks.map((item) => item.id === id ? { ...item, listId } : item); });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); onlineManager.setOnline(true); Reflect.deleteProperty(window, "matchMedia"); });

it("separates task navigation from settings groups", async () => {
  setup();
  const rail = screen.getByRole("navigation", { name: "一级导航" });
  expect(rail.querySelectorAll("button")).toHaveLength(4);
  expect(screen.getByRole("navigation", { name: "任务视图" }).querySelectorAll("button")).toHaveLength(5);
  expect(await screen.findByRole("button", { name: "打开清单：工作" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "新建标签" })).toBeTruthy();
  expect(screen.queryByRole("form", { name: "创建标签" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^日历$/ }));
  await screen.findByRole("heading", { name: "日历" });
  expect(await screen.findByRole("button", { name: "上个月" })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "任务视图" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^任务$/ }));
  fireEvent.click(screen.getByRole("button", { name: "打开今天" }));
  await screen.findByRole("heading", { name: "今天" });
  expect(screen.getByRole("button", { name: "打开清单：工作" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^设置$/ }));
  await screen.findByRole("heading", { name: "常规" });
  expect(screen.queryByRole("navigation", { name: "任务视图" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^数据$/ }));
  await screen.findByRole("heading", { name: "数据" });
  fireEvent.click(screen.getByRole("button", { name: /^统计$/ }));
  await screen.findByRole("heading", { name: "统计" });
  await screen.findByText("完成进度");
  expect(screen.getByRole("progressbar", { name: "任务完成率" }).getAttribute("aria-valuenow")).toBe("0");
  fireEvent.click(screen.getByRole("button", { name: /^任务$/ }));
  await screen.findByRole("heading", { name: "收件箱" });
});

it("opens the task inspector from a calendar day cell task", async () => {
  const due = new Date();
  due.setDate(due.getDate() + 1);
  due.setHours(12, 0, 0, 0);
  tasks = [{ ...task, title: "Calendar task", dueAt: due.toISOString() }];
  setup();
  fireEvent.click(screen.getByRole("button", { name: /^日历$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "打开任务：Calendar task" }));
  expect(await screen.findByRole("dialog", { name: "Calendar task" })).toBeTruthy();
});

it("closes compact navigation after choosing a task view", async () => {
  setup();
  const trigger = screen.getByRole("button", { name: "打开任务视图" });
  fireEvent.click(trigger);
  const close = screen.getByRole("button", { name: "关闭视图导航" });
  await waitFor(() => expect(document.activeElement).toBe(close));
  fireEvent.keyDown(close, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(document.querySelector('button[aria-label="关闭视图导航背景"]')).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "打开今天" }));
  await screen.findByRole("heading", { name: "今天" });
  expect(document.querySelector('button[aria-label="关闭视图导航背景"]')).toBeNull();
});

it("saves a dirty wide inspector before opening another task", async () => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  tasks = [task, { ...task, id: 2, title: "Second task" }];
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "打开清单：工作" }));
  fireEvent.click(await screen.findByRole("button", { name: "编辑任务：Work task" }));
  const title = await screen.findByLabelText("任务标题");
  fireEvent.change(title, { target: { value: "Unsaved title" } });
  fireEvent.click(screen.getByRole("button", { name: "编辑任务：Second task" }));
  await waitFor(() => expect(contentRepository.save).toHaveBeenCalledWith(1, "Unsaved title", expect.any(Object), 0));
  await waitFor(() => expect((screen.getByLabelText("任务标题") as HTMLInputElement).value).toBe("Second task"));
});

it("creates a selected list and new task in it while offline; renames and invalidates caches", async () => {
  onlineManager.setOnline(false);
  const client = setup();
  await screen.findByRole("button", { name: "打开清单：工作" });
  client.setQueryData(taskKeys.detail(1), task); client.setQueryData(taskKeys.counts(), 1);
  openCreateList();
  change("新清单名称", "  个人  ");
  fireEvent.submit(screen.getByRole("form", { name: "创建清单" }));
  await screen.findByRole("heading", { name: "个人" });
  expect(screen.queryByRole("form", { name: "创建清单" })).toBeNull();
  change("新任务", "Personal task"); fireEvent.submit(screen.getByRole("form", { name: "新增任务" }));
  await screen.findByText("Personal task");
  expect(taskRepository.create).toHaveBeenCalledWith({ title: "Personal task", listId: 2 });
  openListManagement("个人"); fireEvent.click(screen.getByRole("button", { name: "重命名清单" }));
  change("清单名称", "  私人项目  "); fireEvent.submit(screen.getByRole("form", { name: "重命名清单" }));
  await screen.findByRole("heading", { name: "私人项目" });
  expect(listRepository.rename).toHaveBeenCalledWith(2, "私人项目");
  expect(client.getQueryState(taskKeys.detail(1))?.isInvalidated).toBe(true);
  expect(client.getQueryState(taskKeys.counts())?.isInvalidated).toBe(true);
});

it("moves tasks, confirms/cancels deletion, refetches Inbox and resets a deleted view", async () => {
  const client = setup();
  await screen.findByRole("button", { name: "打开清单：工作" });
  fireEvent.click(screen.getByRole("button", { name: "打开清单：工作" }));
  await screen.findByText("Work task");
  await move("inbox");
  await screen.findByText("工作为空");
  expect(taskRepository.update).toHaveBeenCalledWith(1, expect.objectContaining({ listId: null }));
  fireEvent.click(screen.getByRole("button", { name: "打开收件箱" }));
  await screen.findByText("Work task");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: "工作" })).toBeNull();
  await move("1"); await screen.findByText("收件箱为空");
  fireEvent.click(screen.getByRole("button", { name: "打开清单" }));
  fireEvent.click(await screen.findByRole("button", { name: "打开清单：工作" }));
  await screen.findByText("Work task");
  const inactive = taskKeys.list({ view: "list", listId: 2 }); client.setQueryData(inactive, []);
  openListManagement("工作");
  fireEvent.click(screen.getByRole("button", { name: "删除清单" }));
  expect(screen.getByText("删除清单“工作”？任务会回到收件箱，不会被删除。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取消删除清单" }));
  expect(listRepository.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "删除清单" })); fireEvent.click(screen.getByRole("button", { name: "确认删除清单" }));
  await screen.findByRole("heading", { name: "收件箱" });
  await screen.findByText("Work task");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "打开清单：工作" })).toBeNull();
  expect(client.getQueryState(inactive)?.isInvalidated).toBe(true);
});

it("preserves drafts, membership and selection on failed create/rename/move/delete", async () => {
  const client = setup();
  await screen.findByRole("button", { name: "打开清单：工作" });
  client.setQueryData(taskKeys.counts(), 1);
  let reject!: (error: Error) => void;
  vi.mocked(listRepository.create).mockReturnValue(new Promise((_resolve, failure) => { reject = failure; }));
  openCreateList();
  change("新清单名称", "保留草稿");
  const form = screen.getByRole("form", { name: "创建清单" }); fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => expect(listRepository.create).toHaveBeenCalledTimes(1));
  await act(async () => { reject(new Error("locked")); });
  await screen.findByText("创建清单失败，输入已保留。请重试。");
  expect((screen.getByLabelText("新清单名称") as HTMLInputElement).value).toBe("保留草稿");
  expect(client.getQueryState(taskKeys.counts())?.isInvalidated).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "打开清单：工作" })); await screen.findByText("Work task");
  vi.mocked(listRepository.rename).mockRejectedValue(new Error("locked"));
  openListManagement("工作");
  fireEvent.click(screen.getByRole("button", { name: "重命名清单" })); change("清单名称", "新名称");
  fireEvent.submit(screen.getByRole("form", { name: "重命名清单" }));
  await screen.findByText("重命名失败，输入已保留。请重试。");
  expect(screen.getByRole("heading", { name: "工作" })).toBeTruthy();
  expect((screen.getByLabelText("清单名称") as HTMLInputElement).value).toBe("新名称");
  fireEvent.click(screen.getByRole("button", { name: "取消重命名" }));
  vi.mocked(taskRepository.update).mockRejectedValue(new Error("foreign key constraint"));
  fireEvent.click(screen.getByRole("button", { name: "编辑任务：Work task" }));
  fireEvent.click(await screen.findByLabelText("所属清单"));
  fireEvent.click(screen.getByRole("button", { name: "收件箱" }));
  await screen.findByText("清单保存失败，请重试。");
  expect(tasks[0].listId).toBe(1);
  fireEvent.click(screen.getByRole("button", {name:"关闭"}));
  fireEvent.click(screen.getByRole("button", {name:"关闭任务详情"}));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  vi.mocked(listRepository.delete).mockRejectedValue(new Error("locked"));
  fireEvent.click(screen.getByRole("button", { name: "删除清单" })); fireEvent.click(screen.getByRole("button", { name: "确认删除清单" }));
  await screen.findByText("清单删除失败，任务和清单仍保留。请重试。");
  expect(screen.getByRole("heading", { name: "工作" })).toBeTruthy(); expect(screen.getByText("Work task")).toBeTruthy();
});

it("rejects blank names and resolves a selection removed on refetch to Inbox", async () => {
  const client = setup();
  await screen.findByRole("button", { name: "打开清单：工作" });
  openCreateList();
  change("新清单名称", "   "); fireEvent.submit(screen.getByRole("form", { name: "创建清单" }));
  await screen.findByText("清单名称长度必须为 1 至 100 个字符"); expect(listRepository.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "打开清单：工作" })); await screen.findByText("Work task");
  change("新任务", "外部删除后保留的输入");
  lists = []; tasks = [{ ...task, listId: null }];
  await act(async () => { await client.invalidateQueries({ queryKey: listKeys.all }); });
  await screen.findByRole("heading", { name: "收件箱" }); await screen.findByText("Work task");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect((screen.getByLabelText("新任务") as HTMLInputElement).value).toBe("外部删除后保留的输入");
});

it("uses a real dialog to keep or explicitly discard new task input before changing views", async () => {
  setup(); fireEvent.click(screen.getByRole("button", { name: "打开收件箱" }));
  await screen.findByText("收件箱为空"); change("新任务", "未保存草稿");
  fireEvent.click(screen.getByRole("button", { name: "打开今天" }));
  await screen.findByRole("dialog"); fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect((screen.getByLabelText("新任务") as HTMLInputElement).value).toBe("未保存草稿");
  fireEvent.click(screen.getByRole("button", { name: "打开今天" }));
  fireEvent.click(await screen.findByRole("button", { name: "放弃输入并继续" }));
  await screen.findByRole("heading", { name: "今天" });
  fireEvent.click(screen.getByRole("button", { name: "打开收件箱" }));
  await screen.findByLabelText("新任务"); expect((screen.getByLabelText("新任务") as HTMLInputElement).value).toBe("");
});

async function move(target: string) {
  fireEvent.click(screen.getByRole("button", { name: "编辑任务：Work task" }));
  fireEvent.click(await screen.findByLabelText("所属清单"));
  fireEvent.click(screen.getByRole("button", { name: target === "inbox" ? "收件箱" : "工作" }));
  await waitFor(() => expect(screen.queryByRole("dialog", {name:"所属清单"})).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "关闭任务详情" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}
