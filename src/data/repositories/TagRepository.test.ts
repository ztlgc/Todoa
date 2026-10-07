import { expect, it, vi } from "vitest";
import type { SqlDatabase } from "@/data/db/SqlDatabase";
import { parseTagId, parseTagName, TagConflictError } from "@/domain/tag";
import { mapTagRow, mapTaskTagRow, TagNotFoundError, TaskTagNotFoundError, TagRepository, type TagRow } from "./TagRepository";

const time = "2026-10-04T04:00:00.000Z";
it("renames tags with bound values and reports conflicts or missing tags", async () => {
  const { repo, execute, select } = setup();
  await repo.rename(2, "  家庭  ");
  expect(execute).toHaveBeenLastCalledWith("UPDATE OR IGNORE tags SET name = ?, updated_at = ? WHERE id = ?", ["家庭", time, 2]);
  execute.mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });
  await expect(repo.rename(2, "Other")).rejects.toBeInstanceOf(TagConflictError);
  select.mockResolvedValueOnce([]);
  await expect(repo.rename(2, "Other")).rejects.toBeInstanceOf(TagNotFoundError);
});
const row: TagRow = { id: 2, name: "Work", created_at: time, updated_at: time };
function setup() {
  const select = vi.fn(async (query: string) => query.includes("FROM task_tags") ? [{ task_id: 4, tag_id: 2 }] : [row]);
  const execute = vi.fn(async () => ({ rowsAffected: 1, lastInsertId: 2 }));
  const database = vi.fn(async (): Promise<SqlDatabase> => ({ select: select as SqlDatabase["select"], execute }));
  return { repo: new TagRepository(database, () => new Date(time)), select, execute, database };
}

it("validates trimmed Unicode names and IDs without case-normalizing stored names", () => {
  expect(parseTagName("  Work 家庭  ")).toBe("Work 家庭");
  expect(parseTagName("😀".repeat(100))).toHaveLength(200);
  for (const value of ["", "  ", "x".repeat(101), "bad\0tag", "bad\ud800", "bad\udfff", null, 12]) expect(() => parseTagName(value)).toThrow();
  for (const id of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, "2"]) expect(() => parseTagId(id)).toThrow();
  expect(mapTagRow(row)).toEqual({ id: 2, name: "Work", createdAt: time, updatedAt: time });
  expect(mapTaskTagRow({ task_id: 4, tag_id: 2 })).toEqual({ taskId: 4, tagId: 2 });
  expect(() => mapTaskTagRow({ task_id: 0, tag_id: 2 })).toThrow();
});

it("binds names and reads the inserted ID; translates only name conflicts", async () => {
  const { repo, execute, select } = setup();
  await repo.create("  O'Brien 家庭  ");
  expect(execute).toHaveBeenLastCalledWith("INSERT INTO tags (name, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING", ["O'Brien 家庭", time, time]);
  expect(select).toHaveBeenLastCalledWith(expect.stringContaining("FROM tags WHERE id = ?"), [2]);
  select.mockClear(); execute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 2 });
  await expect(repo.create("work")).rejects.toBeInstanceOf(TagConflictError);
  expect(select).not.toHaveBeenCalled();
  execute.mockRejectedValueOnce(new Error("database is locked"));
  await expect(repo.create("Other")).rejects.toThrow("database is locked");
});

it("lists metadata and relationships with stable ordering and row mapping", async () => {
  const { repo, select } = setup();
  await expect(repo.list()).resolves.toHaveLength(1);
  expect(select).toHaveBeenLastCalledWith(expect.stringContaining("ORDER BY name COLLATE NOCASE ASC, id ASC"), []);
  await expect(repo.listTaskTags()).resolves.toEqual([{ taskId: 4, tagId: 2 }]);
  expect(select).toHaveBeenLastCalledWith("SELECT task_id, tag_id FROM task_tags ORDER BY task_id ASC, tag_id ASC", []);
});

it("assigns idempotently with a narrow conflict target and removes only the relation", async () => {
  const { repo, execute } = setup();
  await repo.assign(4, 2);
  execute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 2 });
  await expect(repo.assign(4, 2)).resolves.toBeUndefined();
  expect(execute).toHaveBeenLastCalledWith("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?) ON CONFLICT(task_id, tag_id) DO NOTHING", [4, 2]);
  await repo.remove(4, 2);
  execute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 2 });
  await expect(repo.remove(4, 2)).rejects.toBeInstanceOf(TaskTagNotFoundError);
  expect(execute).toHaveBeenLastCalledWith("DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?", [4, 2]);
  expect(execute).toHaveBeenCalledTimes(4);
  execute.mockRejectedValueOnce(new Error("FOREIGN KEY constraint failed"));
  await expect(repo.assign(999, 2)).rejects.toThrow("FOREIGN KEY");
});

it("rejects bad IDs before acquiring DB and distinguishes deletion of a missing tag", async () => {
  const { repo, database, execute } = setup();
  await expect(repo.assign(0, 2)).rejects.toThrow();
  await expect(repo.assign(4, 0)).rejects.toThrow();
  await expect(repo.remove(-1, 2)).rejects.toThrow();
  await expect(repo.remove(4, 1.5)).rejects.toThrow();
  await expect(repo.delete(0)).rejects.toThrow();
  await expect(repo.create("bad\0tag")).rejects.toThrow();
  expect(database).not.toHaveBeenCalled();
  await repo.delete(2);
  expect(execute).toHaveBeenLastCalledWith("DELETE FROM tags WHERE id = ?", [2]);
  execute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 2 });
  await expect(repo.delete(2)).rejects.toBeInstanceOf(TagNotFoundError);
});
