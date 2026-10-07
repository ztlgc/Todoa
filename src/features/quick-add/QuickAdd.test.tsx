// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Event as TauriEvent } from "@tauri-apps/api/event";
import { QuickAdd } from "./QuickAdd";
import { parseTaskTitle } from "@/domain/task";

const { focus } = vi.hoisted(() => ({ focus: vi.fn<(handler: (event: TauriEvent<boolean>) => void) => Promise<() => void>>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onFocusChanged: focus, listen: vi.fn(async () => vi.fn()) }) }));
beforeEach(() => { vi.resetAllMocks(); focus.mockResolvedValue(vi.fn()); });
afterEach(cleanup);
function draft(value: string) { fireEvent.change(screen.getByLabelText("任务标题"), { target: { value } }); }
function submit() { fireEvent.submit(screen.getByRole("form", { name: "快速新增任务" })); }

it("shows the same recognition controls as Inbox and submits the selected interpretation", async () => {
  vi.mocked(invoke).mockResolvedValue(1);
  render(<QuickAdd />);
  const original = "每天明天下午3点提醒我开会";
  draft(original);
  expect(screen.getByText("重复：每天")).toBeTruthy();
  expect(screen.getByText(/^提醒：/).textContent).not.toBe("提醒：无");
  submit();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("create_quick_scheduled_task", { input: expect.objectContaining({ title: "提醒我开会", repeatRule: "day:1", reminderOffsets: [0] }) }));
  await waitFor(() => expect((screen.getByLabelText("任务标题") as HTMLInputElement).value).toBe(""));
  draft(original);
  fireEvent.click(screen.getByRole("button", { name: "保留原文" }));
  expect(screen.getByText("日期：已保留原文")).toBeTruthy();
  expect(screen.getByRole("button", { name: "重新识别日期" })).toBeTruthy();
  submit();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("create_quick_task", { title: original }));
});

it("rejects invalid Unicode, NUL, blank and overlong titles before invoking Rust", () => {
  render(<QuickAdd />);
  for (const value of ["  ", "a\0b", "a\ud800", "🦀".repeat(501)]) {
    draft(value); submit();
    expect(screen.getByRole("alert").textContent).toContain("有效字符");
  }
  expect(invoke).not.toHaveBeenCalled();
  expect(parseTaskTitle("\uFEFF 🦀 ")).toBe("🦀");
  expect(parseTaskTitle("🦀".repeat(500))).toHaveLength(1000);
});

it("blocks concurrent submissions and clears only after a successful commit before hiding", async () => {
  let resolve!: (id: number) => void;
  vi.mocked(invoke).mockImplementation((command) => command === "create_quick_task" ? new Promise((done) => { resolve = done; }) : Promise.resolve());
  render(<QuickAdd />); draft("  new task  "); submit(); submit();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("create_quick_task", { title: "new task" });
  expect((screen.getByLabelText("任务标题") as HTMLInputElement).disabled).toBe(true);
  await act(async () => { resolve(1); });
  expect((screen.getByLabelText("任务标题") as HTMLInputElement).value).toBe("");
  expect(invoke).toHaveBeenLastCalledWith("hide_quick_add");
});

it("preserves failed input, and never retries a committed task when hiding fails", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("write failed"));
  render(<QuickAdd />); draft("retained"); submit();
  await screen.findByText("创建失败，输入已保留。请重试。");
  expect((screen.getByLabelText("任务标题") as HTMLInputElement).value).toBe("retained");
  expect(invoke).toHaveBeenCalledTimes(1);
  vi.mocked(invoke).mockImplementation((command) => command === "create_quick_task" ? Promise.resolve(1) : Promise.reject(new Error("hide failed")));
  submit();
  await screen.findByText("任务已创建，但窗口未能隐藏。请按 Escape 关闭。");
  expect((screen.getByLabelText("任务标题") as HTMLInputElement).value).toBe("");
  fireEvent.keyDown(screen.getByLabelText("任务标题"), { key: "Escape" });
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(4));
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "create_quick_task")).toHaveLength(2);
});

it("ignores composition Enter and preserves draft across Escape; native focus refocuses input", async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  const unlisten = vi.fn(); focus.mockResolvedValue(unlisten);
  const mounted = render(<QuickAdd />); draft("输入中");
  fireEvent.compositionStart(screen.getByLabelText("任务标题"));
  fireEvent.keyDown(screen.getByLabelText("任务标题"), { key: "Enter", isComposing: true });
  submit();
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.compositionEnd(screen.getByLabelText("任务标题"));
  fireEvent.keyDown(screen.getByLabelText("任务标题"), { key: "Escape" });
  expect(invoke).toHaveBeenCalledWith("hide_quick_add");
  expect((screen.getByLabelText("任务标题") as HTMLInputElement).value).toBe("输入中");
  screen.getByRole("button").focus();
  focus.mock.calls[0][0]({ event: "tauri://focus", id: 1, payload: true });
  expect(document.activeElement).toBe(screen.getByLabelText("任务标题"));
  await act(async () => {});
  mounted.unmount(); expect(unlisten).toHaveBeenCalledTimes(1);
});

it("cleans up a focus subscription completing after unmount", async () => {
  let resolve!: (stop: () => void) => void;
  focus.mockReturnValue(new Promise((done) => { resolve = done; }));
  const mounted = render(<QuickAdd />); mounted.unmount();
  const stop = vi.fn(); resolve(stop);
  await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
});
