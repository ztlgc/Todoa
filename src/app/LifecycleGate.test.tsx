// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { LifecycleGate } from "./LifecycleGate";

const { listen } = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ listen }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("keeps database and mutation consumers unmounted while the tray is registering", async () => {
  listen.mockResolvedValue(vi.fn());
  vi.mocked(invoke).mockResolvedValueOnce("starting").mockResolvedValue("tray-ready");
  render(<LifecycleGate><button>编辑任务</button></LifecycleGate>);
  expect(screen.queryByRole("button")).toBeNull();
  await screen.findByRole("button", { name: "编辑任务" });
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("explains tray failure while retaining a visible Main", async () => {
  listen.mockResolvedValue(vi.fn()); vi.mocked(invoke).mockResolvedValue("tray-unavailable");
  render(<LifecycleGate><p>编辑任务</p></LifecycleGate>);
  await screen.findByText(/关闭主窗口将退出应用/);
  expect(screen.getByText("编辑任务")).toBeTruthy();
});

it("removes mutation UI on Quit and ignores a late startup status", async () => {
  listen.mockResolvedValue(vi.fn());
  let resolve!: (value: string) => void;
  vi.mocked(invoke).mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<LifecycleGate><button>新增任务</button></LifecycleGate>);
  await act(async () => {});
  act(() => { listen.mock.calls[0][1](); });
  expect(screen.queryByRole("button")).toBeNull();
  await act(async () => { resolve("tray-ready"); });
  expect(screen.getByRole("status").textContent).toContain("正在退出");
  expect(screen.queryByRole("button")).toBeNull();
});
