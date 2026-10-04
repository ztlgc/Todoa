import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { withMainWriteLeases } from "./mainWriteLease";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("rejects new writes before SQL when Rust is quitting", async () => {
  vi.mocked(invoke).mockReset().mockRejectedValue("APP_QUITTING");
  const execute = vi.fn();
  const db = withMainWriteLeases({ execute, select: vi.fn() });
  await expect(db.execute("DELETE FROM tasks")).rejects.toBe("APP_QUITTING");
  expect(execute).not.toHaveBeenCalled();
});

it("releases failed and successful SQL writes without turning a lost acknowledgment into a retry", async () => {
  vi.mocked(invoke).mockReset().mockImplementation((command) => command === "begin_main_write" ? Promise.resolve(7) : Promise.resolve());
  const execute = vi.fn().mockRejectedValue(new Error("SQL failed"));
  const db = withMainWriteLeases({ execute, select: vi.fn() });
  await expect(db.execute("UPDATE tasks", [1])).rejects.toThrow("SQL failed");
  expect(invoke).toHaveBeenLastCalledWith("finish_main_write", { id: 7 });
  execute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 2 });
  vi.mocked(invoke).mockImplementation((command) => command === "begin_main_write" ? Promise.resolve(8) : Promise.reject("ack lost"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(db.execute("INSERT INTO tasks", ["title"])).resolves.toEqual({ rowsAffected: 1, lastInsertId: 2 });
  expect(log).toHaveBeenCalledWith("WRITE_LEASE_RELEASE_FAILED");
  log.mockRestore();
});
