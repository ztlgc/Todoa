// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalQueryClient } from "@/app/queryClient";
import { taskRepository } from "@/data/repositories/TaskRepository";
import { contentRepository } from "@/data/repositories/ContentRepository";
import { TaskDetails } from "./TaskDetails";
import type { Task } from "@/domain/task";
vi.mock("@/data/repositories/TaskRepository", () => ({
  taskRepository: {
    getById: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    trash: vi.fn(),
  },
}));
vi.mock("@/data/repositories/ContentRepository", () => ({
  contentRepository: { save: vi.fn() },
  plainDocument: (text: string) => ({
    type: "doc",
    content: [
      { type: "paragraph", content: text ? [{ type: "text", text }] : [] },
    ],
  }),
}));
vi.mock("./TaskContentEditor", () => ({
  TaskContentEditor: ({
    initial,
    onChange,
    onComposition,
  }: {
    initial: { content: { content: { text: string }[] }[] };
    onChange: (doc: unknown) => void;
    onComposition: (v: boolean) => void;
  }) => (
    <textarea
      aria-label="任务内容"
      defaultValue={initial.content[0]?.content?.[0]?.text ?? ""}
      onCompositionStart={() => onComposition(true)}
      onCompositionEnd={() => onComposition(false)}
      onChange={(e) =>
        onChange({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: e.target.value }],
            },
          ],
        })
      }
    />
  ),
}));
vi.mock("@/features/tags/TaskTags", () => ({
  TaskTags: () => <p>标签管理</p>,
}));
vi.mock("@/features/reminders/TaskReminders", () => ({
  TaskReminders: () => <p>独立提醒管理</p>,
}));
const task: Task = {
  id: 1,
  listId: null,
  title: "原始标题",
  notes: "原始内容",
  dueAt: null,
  status: "todo",
  completedAt: null,
  sortOrder: 0,
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
};
let client: ReturnType<typeof createLocalQueryClient>;
function setup() {
  client = createLocalQueryClient();
  const closed = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TaskDetails
        id={1}
        lists={[
          {
            id: 2,
            name: "工作",
            sortOrder: 0,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
        ]}
        listsUnavailable={false}
        tags={[]}
        taskTags={[]}
        tagsUnavailable={false}
        returnTo={null}
        onClosed={closed}
      />
    </QueryClientProvider>,
  );
  return closed;
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  vi.mocked(taskRepository.getById).mockResolvedValue(task);
  vi.mocked(contentRepository.save).mockResolvedValue(1);
  vi.mocked(taskRepository.update).mockResolvedValue(task);
});
afterEach(() => {
  cleanup();
  client?.clear();
});
it("saves title and content on close while retaining the inspector after normal saves", async () => {
  const closed = setup();
  fireEvent.change(await screen.findByLabelText("任务标题"), {
    target: { value: "新标题" },
  });
  fireEvent.change(screen.getByLabelText("任务内容"), {
    target: { value: "新内容" },
  });
  fireEvent.click(screen.getByLabelText("关闭任务详情"));
  await waitFor(() => expect(closed).toHaveBeenCalledOnce());
  expect(contentRepository.save).toHaveBeenCalledWith(
    1,
    "新标题",
    {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "新内容" }] },
      ],
    },
    0,
  );
});
it("preserves drafts and blocks close after save failures, then retries", async () => {
  vi.mocked(contentRepository.save).mockRejectedValueOnce(new Error("locked"));
  const closed = setup();
  fireEvent.change(await screen.findByLabelText("任务标题"), {
    target: { value: "草稿" },
  });
  fireEvent.click(screen.getByLabelText("关闭任务详情"));
  await screen.findByText("保存失败，草稿已保留。请重试。");
  expect(closed).not.toHaveBeenCalled();
  expect(localStorage.getItem("todoa-content-draft-1")).toContain("草稿");
  fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
  await waitFor(() => expect(contentRepository.save).toHaveBeenCalledTimes(2));
  expect(closed).not.toHaveBeenCalled();
});
it("does not save during Chinese composition", async () => {
  setup();
  const title = await screen.findByLabelText("任务标题");
  fireEvent.compositionStart(title);
  fireEvent.change(title, { target: { value: "中文" } });
  fireEvent.click(screen.getByLabelText("关闭任务详情"));
  expect(contentRepository.save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(title);
  await waitFor(() => expect(contentRepository.save).toHaveBeenCalledOnce());
});
it("serializes saves when new edits arrive during an in-flight write", async () => {
  let resolve!: (v: number) => void;
  vi.mocked(contentRepository.save)
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValue(2);
  const closed = setup();
  const title = await screen.findByLabelText("任务标题");
  fireEvent.change(title, { target: { value: "第一版" } });
  fireEvent.click(screen.getByLabelText("关闭任务详情"));
  await waitFor(() => expect(contentRepository.save).toHaveBeenCalledOnce());
  fireEvent.change(title, { target: { value: "第二版" } });
  await act(async () => resolve(1));
  await waitFor(() => expect(closed).toHaveBeenCalledOnce());
  expect(contentRepository.save).toHaveBeenLastCalledWith(
    1,
    "第二版",
    expect.any(Object),
    1,
  );
});
it("offers explicit recovery for a persisted draft", async () => {
  localStorage.setItem(
    "todoa-content-draft-1",
    JSON.stringify({
      title: "恢复标题",
      doc: { type: "doc", content: [{ type: "paragraph" }] },
    }),
  );
  setup();
  await screen.findByText("草稿标题：恢复标题");
  expect((screen.getByLabelText("任务标题") as HTMLTextAreaElement).value).toBe(
    "原始标题",
  );
  fireEvent.click(screen.getByRole("button", { name: "恢复草稿" }));
  expect((screen.getByLabelText("任务标题") as HTMLTextAreaElement).value).toBe(
    "恢复标题",
  );
});
it("configures date-only recurrence in one submit and cancels without writes", async () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  setup();
  fireEvent.click(await screen.findByLabelText("日期与提醒"));
  fireEvent.click(screen.getByRole("button", { name: "明天" }));
  fireEvent.change(screen.getByLabelText("重复规则"), {
    target: { value: "day:1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(taskRepository.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("日期与提醒"));
  fireEvent.click(screen.getByRole("button", { name: dueDate }));
  fireEvent.change(screen.getByLabelText("重复规则"), {
    target: { value: "day:1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确定" }));
  await waitFor(() =>
    expect(taskRepository.update).toHaveBeenCalledWith(1, {
      dueAt: null,
      dueDate,
      repeatRule: "day:1",
      reminderOffsets: [],
    }),
  );
});
it("preserves exact existing seconds when the schedule is unchanged", async () => {
  const due = "2027-10-08T07:00:12.345Z";
  vi.mocked(taskRepository.getById).mockResolvedValue({ ...task, dueAt: due });
  setup();
  fireEvent.click(await screen.findByLabelText("日期与提醒"));
  fireEvent.click(screen.getByRole("button", { name: "确定" }));
  await waitFor(() =>
    expect(taskRepository.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ dueAt: due }),
    ),
  );
});
it("moves deletion to the more menu and flushes content before completion", async () => {
  const closed = setup();
  const title = await screen.findByLabelText("任务标题");
  expect(screen.queryByRole("button", { name: "移入回收站" })).toBeNull();
  fireEvent.change(title, { target: { value: "保存再完成" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "完成任务" }));
  await waitFor(() =>
    expect(taskRepository.updateStatus).toHaveBeenCalledWith(1, "completed"),
  );
  expect(contentRepository.save).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByLabelText("更多任务操作"));
  fireEvent.click(screen.getByRole("button", { name: "移入回收站" }));
  await waitFor(() => expect(taskRepository.trash).toHaveBeenCalledWith(1));
  expect(closed).toHaveBeenCalledOnce();
});
