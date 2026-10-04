// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AutostartSettings } from "./AutostartSettings";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("shows the observed OS state and rereads after success, without optimistic enable", async () => {
  vi.mocked(invoke).mockImplementation(async command => command === "set_autostart" ? false : false);
  render(<AutostartSettings />); await screen.findByText("系统实际状态：已关闭");
  fireEvent.click(screen.getByRole("checkbox", { name: "登录后在后台启动 Todoa" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_autostart", { enabled: true }));
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "autostart_status").length).toBe(2));
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
});
it("rereads partial OS changes after update error and retains the error", async () => {
  let reads = 0;
  vi.mocked(invoke).mockImplementation(async command => { if (command === "set_autostart") throw new Error("registry failure"); return ++reads > 1; });
  render(<AutostartSettings />); await screen.findByText("系统实际状态：已关闭");
  fireEvent.click(screen.getByRole("checkbox")); await screen.findByText("系统实际状态：已启用");
  expect(screen.getByRole("alert").textContent).toContain("更改开机启动失败");
});
it("represents a failed OS read as unknown and disables the control", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("read failure"));
  render(<AutostartSettings />); await screen.findByRole("alert");
  expect(screen.getByRole("status").textContent).toBe("系统状态尚未确认");
  expect(screen.getByRole("checkbox").getAttribute("aria-disabled")).toBe("true");
});
