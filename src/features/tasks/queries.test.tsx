// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, hashKey, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type Database from "@tauri-apps/plugin-sql";
import { DatabaseGate } from "@/app/DatabaseGate";
import { MainQueryProvider } from "@/app/MainQueryProvider";
import { createLocalQueryClient } from "@/app/queryClient";
import { initDatabase } from "@/data/db/initDatabase";
import { taskRepository } from "@/data/repositories/TaskRepository";
import type { Task } from "@/domain/task";
import { taskKeys } from "./queryKeys";
import { useCreateTask, useDeleteTask, useTasks, useUpdateTaskStatus, useUpdateTask } from "./queries";

vi.mock("@/data/db/initDatabase", () => ({ initDatabase: vi.fn() }));
vi.mock("@/data/repositories/TaskRepository", () => ({
  taskRepository: { list: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), delete: vi.fn(), update: vi.fn() },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: vi.fn(async () => vi.fn()), listen: vi.fn(async () => vi.fn()) }),
}));

const task: Task = {
  id: 1, listId: null, title: "Buy milk", notes: "", status: "todo",
  dueAt: null, completedAt: null, sortOrder: 0,
  createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z",
};
const clients: ReturnType<typeof createLocalQueryClient>[] = [];

function setupHooks() {
  const client = createLocalQueryClient();
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({
    tasks: useTasks({ listId: null }), create: useCreateTask(),
    update: useUpdateTaskStatus(), remove: useDeleteTask(),
    edit: useUpdateTask(),
  }), { wrapper });
  return { ...hook, client };
}

function TasksProbe() {
  const query = useTasks();
  return <p>{query.data ? `tasks:${query.data.length}` : "query-pending"}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  onlineManager.setOnline(true);
  vi.mocked(taskRepository.list).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  onlineManager.setOnline(true);
});

describe("Ready boundary and task query keys", () => {
  it("edits locally while offline and invalidates Today, Upcoming, detail and counts", async () => {
    onlineManager.setOnline(false);
    vi.mocked(taskRepository.update).mockResolvedValue(task);
    const { result, client } = setupHooks();
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));
    const today = taskKeys.list({ view: "today", status: "todo", dateRange: { from: "2026-10-04T16:00:00.000Z", to: "2026-10-05T16:00:00.000Z" } });
    const upcoming = taskKeys.list({ view: "upcoming", status: "todo", dateRange: { from: "2026-10-05T16:00:00.000Z" } });
    for (const key of [today, upcoming, taskKeys.detail(1), taskKeys.counts()]) client.setQueryData(key, []);
    await act(async () => { await result.current.edit.mutateAsync({ id: 1, input: { dueAt: null } }); });
    expect(taskRepository.update).toHaveBeenCalledWith(1, { dueAt: null });
    expect(result.current.edit.isPaused).toBe(false);
    for (const key of [today, upcoming, taskKeys.detail(1), taskKeys.counts()]) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
  it("does not mount query consumers until database Ready", async () => {
    let ready!: (database: Database) => void;
    vi.mocked(initDatabase).mockReturnValue(new Promise((resolve) => { ready = resolve; }));
    render(<DatabaseGate><MainQueryProvider><TasksProbe /></MainQueryProvider></DatabaseGate>);
    expect(screen.getByRole("status").textContent).toContain("正在检查");
    expect(taskRepository.list).not.toHaveBeenCalled();
    await act(async () => { ready({} as Database); });
    await screen.findByText("tasks:0");
    expect(taskRepository.list).toHaveBeenCalledTimes(1);
  });

  it("keeps business queries unmounted after boot failure", async () => {
    vi.mocked(initDatabase).mockRejectedValue(new Error("boot failed"));
    render(<DatabaseGate><MainQueryProvider><TasksProbe /></MainQueryProvider></DatabaseGate>);
    await screen.findByRole("alert");
    expect(taskRepository.list).not.toHaveBeenCalled();
  });

  it("distinguishes view, Inbox, list, tag, status and date ranges", () => {
    const scopes = [
      { view: "all" as const },
      { view: "inbox" as const, listId: null },
      { view: "list" as const, listId: 1 },
      { view: "list" as const, listId: 2 },
      { view: "tag" as const, tagId: 1 },
      { view: "tag" as const, tagId: 2 },
      { view: "all" as const, status: "completed" as const },
      { view: "today" as const, dateRange: { from: "2026-10-04T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z" } },
      { view: "today" as const, dateRange: { from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" } },
    ];
    expect(new Set(scopes.map((scope) => hashKey(taskKeys.list(scope)))).size).toBe(scopes.length);
    expect(hashKey(taskKeys.list({ view: "all" }))).not.toBe(hashKey(taskKeys.list({ view: "all", listId: null })));
  });
});

describe("local mutations and cache invalidation", () => {
  it("queries and runs all mutations while offline, refetching the active list", async () => {
    onlineManager.setOnline(false);
    let rows: Task[] = [];
    vi.mocked(taskRepository.list).mockImplementation(async () => [...rows]);
    vi.mocked(taskRepository.create).mockImplementation(async () => { rows = [task]; return task; });
    vi.mocked(taskRepository.updateStatus).mockImplementation(async (_id, status) => { rows = [{ ...task, status }]; });
    vi.mocked(taskRepository.delete).mockImplementation(async () => { rows = []; });
    const { result, client } = setupHooks();
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));
    client.setQueryData(taskKeys.detail(1), task);
    client.setQueryData(taskKeys.detail(2), { ...task, id: 2 });
    client.setQueryData(taskKeys.counts(), 0);
    const otherList = taskKeys.list({ view: "all", status: "completed" });
    client.setQueryData(otherList, []);

    await act(async () => { await result.current.create.mutateAsync({ title: task.title }); });
    await waitFor(() => expect(result.current.tasks.data).toEqual([task]));
    expect(client.getQueryState(taskKeys.detail(1))?.isInvalidated).toBe(true);
    expect(client.getQueryState(taskKeys.detail(2))?.isInvalidated).toBe(false);
    expect(client.getQueryState(taskKeys.counts())?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherList)?.isInvalidated).toBe(true);

    client.setQueryData(taskKeys.detail(1), task);
    client.setQueryData(taskKeys.counts(), 1);
    await act(async () => { await result.current.update.mutateAsync({ id: 1, status: "completed" }); });
    await waitFor(() => expect(result.current.tasks.data?.[0].status).toBe("completed"));
    expect(client.getQueryState(taskKeys.detail(1))?.isInvalidated).toBe(true);
    expect(client.getQueryState(taskKeys.counts())?.isInvalidated).toBe(true);

    client.setQueryData(taskKeys.detail(1), task);
    client.setQueryData(taskKeys.counts(), 1);
    await act(async () => { await result.current.remove.mutateAsync(1); });
    await waitFor(() => expect(result.current.tasks.data).toEqual([]));
    expect(client.getQueryState(taskKeys.detail(1))?.isInvalidated).toBe(true);
    expect(client.getQueryState(taskKeys.counts())?.isInvalidated).toBe(true);
    expect(result.current.tasks.fetchStatus).toBe("idle");
    expect(result.current.create.isPaused).toBe(false);
    expect(result.current.update.isPaused).toBe(false);
    expect(result.current.remove.isPaused).toBe(false);
    expect(taskRepository.list).toHaveBeenCalledTimes(4);
  });

  it("does not report success, retry writes or change cached data on failure", async () => {
    vi.mocked(taskRepository.list).mockResolvedValue([task]);
    vi.mocked(taskRepository.create).mockRejectedValue(new Error("database locked"));
    const { result, client } = setupHooks();
    await waitFor(() => expect(result.current.tasks.data).toEqual([task]));
    client.setQueryData(taskKeys.counts(), 1);
    await act(async () => { await expect(result.current.create.mutateAsync({ title: "new" })).rejects.toThrow("database locked"); });
    await waitFor(() => expect(result.current.create.isError).toBe(true));
    expect(result.current.create.isSuccess).toBe(false);
    expect(result.current.tasks.data).toEqual([task]);
    expect(client.getQueryState(taskKeys.counts())?.isInvalidated).toBe(false);
    expect(taskRepository.create).toHaveBeenCalledTimes(1);
    expect(taskRepository.list).toHaveBeenCalledTimes(1);
  });

  it("bounds read retries even while offline", async () => {
    onlineManager.setOnline(false);
    vi.mocked(taskRepository.list).mockRejectedValue(new Error("read failure"));
    const { result } = setupHooks();
    await waitFor(() => expect(result.current.tasks.isError).toBe(true));
    expect(taskRepository.list).toHaveBeenCalledTimes(2);
    expect(result.current.tasks.fetchStatus).toBe("idle");
  });
});
