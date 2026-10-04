// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { BackupRestorePanel } from "./BackupRestorePanel";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("requires concrete replacement confirmation and preserves errors for retry", async () => {
  vi.mocked(invoke).mockRejectedValue("BACKUP_INTEGRITY"); render(<BackupRestorePanel />);
  fireEvent.click(screen.getByRole("button", { name: "恢复备份" }));
  expect(invoke).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog").textContent).toContain("替换现有任务");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消恢复" })));
  fireEvent.click(screen.getByRole("button", { name: "确认替换并选择备份" }));
  await screen.findByText(/恢复失败：BACKUP_INTEGRITY/);
  expect(screen.getByRole("alertdialog").textContent).toContain("恢复失败：BACKUP_INTEGRITY");
  expect(invoke).toHaveBeenCalledWith("restore_database", { confirmed: true });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "恢复备份" })));
});
it("treats dialog cancellation separately from success and blocks duplicate requests", async () => {
  let resolve!: (value: string) => void;
  vi.mocked(invoke).mockReturnValue(new Promise<string>(done => { resolve = done; }));
  render(<BackupRestorePanel />);
  const button = screen.getByRole("button", { name: "备份数据" });
  fireEvent.click(button); fireEvent.click(button);
  expect(invoke).toHaveBeenCalledTimes(1); resolve("cancelled");
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("已取消，数据未替换。"));
  expect(screen.queryByText("备份已保存（未加密）。")).toBeNull();
});
