import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { get: vi.fn() } }));
const select = vi.fn();
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.mocked(invoke).mockResolvedValue(4);
  select.mockResolvedValue([{ user_version: 4 }]);
  vi.mocked(Database.get).mockReturnValue({ select, execute: vi.fn() } as unknown as Database);
});
it("opens a desktop database with all four migrations applied", async () => {
  const { initDatabase } = await import("./initDatabase");
  await expect(initDatabase()).resolves.toHaveProperty("select");
  expect(invoke).toHaveBeenCalledWith("database_boot_status");
  expect(select).toHaveBeenCalledWith("PRAGMA user_version");
});
it("rejects mismatched database schema after a successful native boot", async () => {
  select.mockResolvedValue([{ user_version: 3 }]);
  const { initDatabase } = await import("./initDatabase");
  await expect(initDatabase()).rejects.toThrow("SCHEMA_VERSION_MISMATCH");
});
it("does not open SQL when native boot fails", async () => {
  vi.mocked(invoke).mockRejectedValue("MIGRATION_HISTORY_MISSING");
  const { initDatabase } = await import("./initDatabase");
  await expect(initDatabase()).rejects.toBe("MIGRATION_HISTORY_MISSING");
  expect(Database.get).not.toHaveBeenCalled();
});
