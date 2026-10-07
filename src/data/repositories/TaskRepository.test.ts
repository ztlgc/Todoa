import { describe, expect, it, vi } from "vitest";
import {
  parseCreateTaskInput,
  parseTaskFilters,
  parseTaskId,
  parseTaskTime,
  parseUpdateTaskInput,
} from "@/domain/task";
import { mapTaskRow, TaskNotFoundError, TaskRepository, type TaskDatabase, type TaskRow } from "./TaskRepository";
import { parseNaturalTaskInput } from "@/domain/naturalTaskInput";

const row: TaskRow = {
  id: 4,
  list_id: null,
  title: "Buy milk",
  notes: "",
  status: "todo",
  due_at: null,
  completed_at: null,
  sort_order: 0,
  created_at: "2026-10-04T01:02:03.000Z",
  updated_at: "2026-10-04T01:02:03.000Z",
};

function fakeDatabase(rows: TaskRow[] = [row]) {
  const select = vi.fn(async () => rows);
  const execute = vi.fn(async () => ({ rowsAffected: 1, lastInsertId: 4 }));
  const db: TaskDatabase = { select: select as TaskDatabase["select"], execute };
  const command=vi.fn(async()=>undefined);
  const repo = new TaskRepository(async () => db, () => new Date("2026-10-04T02:03:04.005Z"),command as never);
  return { repo, select, execute,command };
}

describe("Task domain and row mapping", () => {
  it("maps all snake_case fields and preserves null", () => {
    expect(mapTaskRow(row)).toEqual({
      id: 4, listId: null, title: "Buy milk", notes: "", status: "todo", priority: "none",
      dueAt: null, contentJson: null, contentRevision: 0, dueDate: null, repeatRule: null, reminderOffsets: [], completedAt: null, deletedAt: null, sortOrder: 0,
      createdAt: "2026-10-04T01:02:03.000Z", updatedAt: "2026-10-04T01:02:03.000Z",
    });
    expect(mapTaskRow({ ...row, list_id: 2, status: "completed", completed_at: "2026-10-04T02:03:04.005Z" }).completedAt)
      .toBe("2026-10-04T02:03:04.005Z");
    expect(() => mapTaskRow({ ...row, status: "completed" })).toThrow();
  });

  it("validates IDs, title, notes, dates and filter distinction", () => {
    for (const id of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      expect(() => parseTaskId(id)).toThrow();
    }
    expect(() => parseCreateTaskInput({ title: "  " })).toThrow();
    expect(() => parseCreateTaskInput({ title: "x".repeat(501) })).toThrow();
    expect(() => parseCreateTaskInput({ title: "ok", notes: "x".repeat(100001) })).toThrow();
    expect(() => parseUpdateTaskInput({})).toThrow();
    expect(parseCreateTaskInput({ title: "ok", priority: "high" }).priority).toBe("high");
    expect(parseUpdateTaskInput({ priority: "low" })).toEqual({ priority: "low" });
    expect(() => parseUpdateTaskInput({ priority: "urgent" as "high" })).toThrow();
    expect(() => parseTaskFilters({ status: "invalid" as "todo" })).toThrow();
    expect(parseTaskFilters({})).toEqual({});
    expect(parseTaskFilters({ listId: null })).toEqual({ listId: null });
    expect(parseTaskTime("2026-10-04T10:02:03.5+08:00")).toBe("2026-10-04T02:02:03.500Z");
    expect(() => parseTaskTime("2026-02-30T10:02:03Z")).toThrow();
    expect(() => parseTaskTime("2026-10-04")).toThrow();
    expect(() => parseTaskTime("2026-10-04T10:02:03+14:30")).toThrow();
  });
});

describe("TaskRepository fake adapter protocol", () => {
  it("reads detail, updates only bound allowed fields atomically, clears dates and rejects missing rows", async () => {
    const { repo, select, execute, command } = fakeDatabase();
    expect(await repo.getById(4)).toMatchObject({ id: 4 });
    await repo.update(4, { title: "  'quoted'  ", notes: "中文\nplain", dueAt: null, listId: 7 });
    expect(command).toHaveBeenCalledWith("update_task_schedule", { id: 4, input: { title: "'quoted'", notes: "中文\nplain", dueAt: null, listId: 7, hasDue: true, hasList: true, hasDate: false, hasRepeat: false } });
    execute.mockClear();
    await expect(repo.update(4, {})).rejects.toThrow();
    await expect(repo.update(4, { listId: 0 })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    execute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 0 });
    await expect(repo.update(4, { notes: "keep draft" })).rejects.toBeInstanceOf(TaskNotFoundError);
    select.mockResolvedValueOnce([]); expect(await repo.getById(4)).toBeNull();
  });
  it("enforces unfinished bounded UTC Today and sorted Upcoming, rejecting invalid ranges", async () => {
    const { repo, select } = fakeDatabase();
    const range = { from: "2026-10-04T16:00:00.000Z", to: "2026-10-05T16:00:00.000Z" };
    await repo.list({ dateView: "today", dateRange: range });
    expect(select).toHaveBeenLastCalledWith(expect.stringContaining("OR (due_date >= ? AND due_date < ?)"), ["todo", range.from, range.to, new Date(range.from).toLocaleDateString("sv-SE"), new Date(range.to).toLocaleDateString("sv-SE")]);
    await repo.list({ dateView: "upcoming", dateRange: { from: range.to } });
    expect(select).toHaveBeenLastCalledWith(expect.stringContaining("(due_at >= ? OR due_date >= ?)"), ["todo", range.to, new Date(range.to).toLocaleDateString("sv-SE")]);
    select.mockClear();
    for (const filters of [{ dateView: "today", dateRange: { from: range.from } }, { dateView: "today", dateRange: { from: range.to, to: range.from } }, { dateView: "upcoming", dateRange: range }, { dateView: "today", dateRange: range, status: "completed" }]) await expect(repo.list(filters as never)).rejects.toThrow();
    expect(select).not.toHaveBeenCalled();
  });
  it("filters by a bound tag through EXISTS, independently of list or status", async () => {
    const { repo, select } = fakeDatabase();
    await repo.list({ tagId: 2 });
    expect(select).toHaveBeenLastCalledWith(expect.stringContaining("deleted_at IS NULL AND EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_id = tasks.id AND task_tags.tag_id = ?) ORDER BY sort_order ASC, id ASC"), [2]);
    await repo.list({ tagId: 2, listId: null, status: "completed" });
    expect(select).toHaveBeenLastCalledWith(expect.stringContaining("deleted_at IS NULL AND status = ? AND list_id IS NULL AND EXISTS"), ["completed", 2]);
    select.mockClear();
    await expect(repo.list({ tagId: 0 })).rejects.toThrow();
    await expect(repo.list({ tagId: -1 })).rejects.toThrow();
    expect(select).not.toHaveBeenCalled();
  });
  it("creates in a list and atomically moves to a list or Inbox, validating targets", async () => {
    const { repo, execute } = fakeDatabase([{ ...row, list_id: 7 }]);
    await expect(repo.create({ title: "Buy milk", listId: 7 })).resolves.toMatchObject({ listId: 7 });
    expect(execute).toHaveBeenLastCalledWith(expect.stringContaining("INSERT INTO tasks"), ["Buy milk", 7, "", null, "none", "2026-10-04T02:03:04.005Z", "2026-10-04T02:03:04.005Z"]);
    await repo.setList(4, 7);
    expect(execute).toHaveBeenLastCalledWith(expect.stringMatching(/^UPDATE tasks SET updated_at = CASE .* list_id = \? WHERE id = \? AND deleted_at IS NULL$/), [7, "2026-10-04T02:03:04.005Z", 7, 4]);
    await repo.setList(4, null);
    expect(execute).toHaveBeenLastCalledWith(expect.stringContaining("list_id = ? WHERE id = ?"), [null, "2026-10-04T02:03:04.005Z", null, 4]);
    for (const id of [0, -1, 1.2]) await expect(repo.setList(4, id)).rejects.toThrow();
    await expect(repo.setList(0, null)).rejects.toThrow();
    await expect(repo.create({ title: "x", listId: 0 })).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(3);
    execute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 4 });
    await expect(repo.setList(4, null)).rejects.toBeInstanceOf(TaskNotFoundError);
  });
  it("binds list filters and keeps stable ordering", async () => {
    const { repo, select } = fakeDatabase();
    await expect(repo.list({ status: "todo", listId: 7 })).resolves.toHaveLength(1);
    expect(select).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE deleted_at IS NULL AND status = \? AND list_id = \? ORDER BY sort_order ASC, id ASC$/),
      ["todo", 7],
    );
    await repo.list({ listId: null });
    expect(select).toHaveBeenLastCalledWith(expect.stringContaining("deleted_at IS NULL AND list_id IS NULL"), []);
    await repo.list();
    expect(select).toHaveBeenLastCalledWith(expect.stringContaining("WHERE deleted_at IS NULL"), []);
    await repo.list({ deleted: true });
    expect(select).toHaveBeenLastCalledWith(expect.stringContaining("WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"), []);
  });

  it("moves, restores and permanently deletes only trashed tasks", async () => {
    const { repo, execute } = fakeDatabase();
    await repo.trash(4);
    expect(execute).toHaveBeenLastCalledWith(expect.stringContaining("UPDATE tasks SET deleted_at = ?"), ["2026-10-04T02:03:04.005Z", "2026-10-04T02:03:04.005Z", 4]);
    await repo.restore(4);
    expect(execute).toHaveBeenLastCalledWith(expect.stringContaining("SET deleted_at = NULL"), ["2026-10-04T02:03:04.005Z", 4]);
    await repo.delete(4);
    expect(execute).toHaveBeenLastCalledWith("DELETE FROM tasks WHERE id = ? AND deleted_at IS NOT NULL", [4]);
  });

  it("binds create values and reads the returned insert ID", async () => {
    const { repo, select, execute } = fakeDatabase();
    await expect(repo.create({ title: "  Buy milk  ", dueAt: "2026-10-04T10:02:03+08:00" }))
      .resolves.toMatchObject({ id: 4, title: "Buy milk" });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, ?, ?, ?, ?, ?, ?)"),
      ["Buy milk", null, "", "2026-10-04T02:02:03.000Z", "none", "2026-10-04T02:03:04.005Z", "2026-10-04T02:03:04.005Z"],
    );
    expect(select).toHaveBeenCalledWith(expect.stringContaining("WHERE id = ?"), [4]);
    execute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 });
    await expect(repo.create({ title: "x" })).rejects.toThrow();
  });
  it("creates the reported daily reminder through the scheduled desktop command", async () => {
    const input = parseNaturalTaskInput("每天明天早上十一点提醒我上班", new Date(2026, 9, 7, 9));
    const { repo, execute, command } = fakeDatabase([{ ...row, title: input.title, due_at: input.dueAt, repeat_rule: input.repeatRule, reminder_offsets: "[0]" }]);
    command.mockResolvedValueOnce(4 as never);
    await expect(repo.create(input)).resolves.toMatchObject({ title: "提醒我上班", repeatRule: "day:1", reminderOffsets: [0] });
    expect(command).toHaveBeenCalledWith("create_scheduled_task", { input: parseCreateTaskInput(input) });
    expect(execute).not.toHaveBeenCalled();
  });

  it("uses only Rust status transaction, and wakes scheduler after committed delete", async () => {
    const {repo,execute,command}=fakeDatabase();
    await repo.updateStatus(4,"completed");
    expect(command).toHaveBeenCalledWith("update_task_status",{id:4,status:"completed"});
    expect(execute).not.toHaveBeenCalled();
    command.mockRejectedValueOnce("TASK_NOT_FOUND");
    await expect(repo.updateStatus(4,"todo")).rejects.toBeInstanceOf(TaskNotFoundError);
    await repo.delete(4);
    expect(command).toHaveBeenLastCalledWith("reconcile_reminders");
    execute.mockResolvedValueOnce({rowsAffected:0,lastInsertId:4});
    await expect(repo.delete(4)).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(repo.delete(0)).rejects.toThrow();
    command.mockClear();
    await expect(repo.updateStatus(0,"todo")).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });
});

it("routes recurrence clearing through the desktop schedule transaction without clearing the date", async () => {
  const { repo, command, execute } = fakeDatabase();
  await repo.update(4, { repeatRule: null });
  expect(command).toHaveBeenCalledWith("update_task_schedule", { id: 4, input: { repeatRule: null, clearRepeat: true, hasDue: false, hasList: false, hasDate: false, hasRepeat: true } });
  expect(execute).not.toHaveBeenCalled();
});
