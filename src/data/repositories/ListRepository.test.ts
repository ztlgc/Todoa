import { expect, it, vi } from "vitest";
import type { SqlDatabase } from "@/data/db/SqlDatabase";
import { parseListId, parseListName } from "@/domain/list";
import { ListNotFoundError, ListRepository, mapListRow, type ListRow } from "./ListRepository";

const time = "2026-10-04T03:00:00.000Z";
const row: ListRow = { id: 2, name: "工作", sort_order: 0, created_at: time, updated_at: time };
function setup() {
  const select = vi.fn(async () => [row]);
  const execute = vi.fn(async () => ({ rowsAffected: 1, lastInsertId: 2 }));
  const database = vi.fn(async (): Promise<SqlDatabase> => ({ select: select as SqlDatabase["select"], execute }));
  return { repo: new ListRepository(database, () => new Date(time)), select, execute, database };
}

it("validates names/IDs and maps every persisted field", () => {
  expect(parseListName("  工作  ")).toBe("工作");
  expect(parseListName("😀".repeat(100))).toHaveLength(200);
  for (const name of ["", "   ", "x".repeat(101), 12]) expect(() => parseListName(name)).toThrow();
  for (const id of [0, -1, 1.2, NaN, Number.MAX_SAFE_INTEGER + 1, "2"]) expect(() => parseListId(id)).toThrow();
  expect(mapListRow(row)).toEqual({ id: 2, name: "工作", sortOrder: 0, createdAt: time, updatedAt: time });
  expect(() => mapListRow({ ...row, sort_order: 0.5 })).toThrow();
});

it("binds names, reads its own insert ID and lists deterministically", async () => {
  const { repo, select, execute } = setup();
  await repo.list();
  expect(select).toHaveBeenLastCalledWith(expect.stringMatching(/ORDER BY sort_order ASC, id ASC$/), []);
  await expect(repo.create("  O'Brien 工作  ")).resolves.toMatchObject({ id: 2 });
  expect(execute).toHaveBeenLastCalledWith("INSERT INTO lists (name, created_at, updated_at) VALUES (?, ?, ?)", ["O'Brien 工作", time, time]);
  expect(select).toHaveBeenLastCalledWith(expect.stringContaining("WHERE id = ?"), [2]);
});

it("renames in one statement and delegates deletion to the FK", async () => {
  const { repo, execute } = setup();
  await repo.rename(2, "  新名称  ");
  expect(execute).toHaveBeenLastCalledWith(expect.stringMatching(/^UPDATE lists SET updated_at = CASE .* name = \? WHERE id = \?$/), ["新名称", time, "新名称", 2]);
  await repo.delete(2);
  expect(execute).toHaveBeenLastCalledWith("DELETE FROM lists WHERE id = ?", [2]);
  expect(execute).toHaveBeenCalledTimes(2);
});

it("rejects invalid input before obtaining a database and reports missing rows", async () => {
  const { repo, execute, database } = setup();
  await expect(repo.create(" ")).rejects.toThrow();
  await expect(repo.rename(0, "ok")).rejects.toThrow();
  await expect(repo.delete(-1)).rejects.toThrow();
  expect(database).not.toHaveBeenCalled();
  execute.mockResolvedValue({ rowsAffected: 0, lastInsertId: 2 });
  await expect(repo.rename(2, "ok")).rejects.toBeInstanceOf(ListNotFoundError);
  await expect(repo.delete(2)).rejects.toBeInstanceOf(ListNotFoundError);
});

it("propagates write rejection without a retry or follow-up success read", async () => {
  const { repo, execute, select } = setup();
  execute.mockRejectedValue(new Error("database is locked"));
  await expect(repo.create("工作")).rejects.toThrow("database is locked");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
});
