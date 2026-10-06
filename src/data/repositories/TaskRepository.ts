import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { browserTaskRepository } from "@/data/browserRepositories";
import { initDatabase } from "@/data/db/initDatabase";
import type { SqlDatabase, SqlValue } from "@/data/db/SqlDatabase";
import { parseListId } from "@/domain/list";
import {
  parseCreateTaskInput,
  parseTaskFilters,
  parseTaskId,
  parseTaskNotes,
  parseTaskPriority,
  parseTaskStatus,
  parseTaskTime,
  parseTaskTitle,
  parseUpdateTaskInput,
  TaskValidationError,
  type CreateTaskInput,
  type Task,
  type TaskFilters,
  type TaskStatus,
  type UpdateTaskInput,
} from "@/domain/task";

export interface TaskRow {
  id: number;
  list_id: number | null;
  title: string;
  notes: string;
  status: string;
  priority?: string;
  due_at: string | null;
  repeat_rule?: string | null;
  reminder_offsets?: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type TaskDatabase = SqlDatabase;

export class TaskNotFoundError extends Error {
  constructor(id: number) {
    super(`任务 ${id} 不存在`);
    this.name = "TaskNotFoundError";
  }
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TaskValidationError(`${field} 不是安全整数`);
  }
  return value;
}

export function mapTaskRow(row: TaskRow): Task {
  const id = parseTaskId(row.id);
  const listId = row.list_id === null ? null : parseListId(row.list_id);
  const status = parseTaskStatus(row.status);
  const completedAt = row.completed_at === null ? null : parseTaskTime(row.completed_at);
  if ((status === "todo") !== (completedAt === null)) {
    throw new TaskValidationError("任务状态与完成时间不一致");
  }
  return {
    id,
    listId,
    title: parseTaskTitle(row.title),
    notes: parseTaskNotes(row.notes),
    status,
    priority: parseTaskPriority(row.priority ?? "none"),
    dueAt: row.due_at === null ? null : parseTaskTime(row.due_at),
    repeatRule: row.repeat_rule ?? null,
    reminderOffsets: row.reminder_offsets ? JSON.parse(row.reminder_offsets) as number[] : [],
    completedAt,
    sortOrder: safeInteger(row.sort_order, "sort_order"),
    createdAt: parseTaskTime(row.created_at),
    updatedAt: parseTaskTime(row.updated_at),
  };
}

const TASK_COLUMNS = "id, list_id, title, notes, status, priority, due_at, repeat_rule, reminder_offsets, completed_at, sort_order, created_at, updated_at";

export class TaskRepository {
  constructor(
    private readonly database: () => Promise<TaskDatabase> = initDatabase,
    private readonly now: () => Date = () => new Date(),
    private readonly command: typeof invoke = invoke,
  ) {}

  async list(filters: TaskFilters = {}): Promise<Task[]> {
    const parsed = parseTaskFilters(filters);
    const conditions: string[] = [];
    const binds: SqlValue[] = [];
    if (parsed.status !== undefined) {
      conditions.push("status = ?");
      binds.push(parsed.status);
    }
    if (parsed.listId === null) {
      conditions.push("list_id IS NULL");
    } else if (parsed.listId !== undefined) {
      conditions.push("list_id = ?");
      binds.push(parsed.listId);
    }
    if (parsed.tagId !== undefined) {
      conditions.push("EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_id = tasks.id AND task_tags.tag_id = ?)");
      binds.push(parsed.tagId);
    }
    if (parsed.dateRange) {
      conditions.push("due_at >= ?");
      binds.push(parsed.dateRange.from);
      if (parsed.dateRange.to) { conditions.push("due_at < ?"); binds.push(parsed.dateRange.to); }
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const rows = await (await this.database()).select<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM tasks${where} ORDER BY ${parsed.dateView ? "due_at ASC, " : ""}sort_order ASC, id ASC`,
      binds,
    );
    return rows.map(mapTaskRow);
  }

  async getById(id: number): Promise<Task | null> {
    const rows = await (await this.database()).select<TaskRow[]>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`, [parseTaskId(id)]);
    if (rows.length > 1) throw new Error("任务主键读取不唯一");
    return rows.length === 0 ? null : mapTaskRow(rows[0]);
  }

  async update(id: number, input: UpdateTaskInput): Promise<Task> {
    const taskId = parseTaskId(id);
    const parsed = parseUpdateTaskInput(input);
    if (parsed.dueAt !== undefined) {
      try {
        await this.command("update_task_schedule", { id: taskId, input: {
          ...parsed, hasDue: true, hasList: parsed.listId !== undefined,
        } });
      } catch (cause) {
        if (cause === "TASK_NOT_FOUND") throw new TaskNotFoundError(taskId);
        throw cause;
      }
      const updated = await this.getById(taskId);
      if (!updated) throw new TaskNotFoundError(taskId);
      return updated;
    }
    const fields: string[] = [];
    const values: SqlValue[] = [];
    const columns = { title: "title", notes: "notes", dueAt: "due_at", listId: "list_id", priority: "priority" } as const;
    for (const key of Object.keys(columns) as (keyof typeof columns)[]) {
      const value = parsed[key];
      if (value !== undefined) { fields.push(`${columns[key]} = ?`); values.push(value); }
    }
    fields.push("updated_at = ?"); values.push(this.timestamp(), taskId);
    const result = await (await this.database()).execute(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`, values);
    if (result.rowsAffected === 0) throw new TaskNotFoundError(taskId);
    if (result.rowsAffected !== 1) throw new Error("任务编辑影响了多行");
    const task = await this.getById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    return task;
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const parsed = parseCreateTaskInput(input);
    if (parsed.repeatRule || parsed.remindAt.length) {
      const id = await this.command<number>("create_scheduled_task", { input: parsed });
      const created = await this.getById(id);
      if (!created) throw new Error("创建后未能读取任务");
      return created;
    }
    const now = this.timestamp();
    const db = await this.database();
    const result = await db.execute(
      "INSERT INTO tasks (title, list_id, notes, due_at, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [parsed.title, parsed.listId, parsed.notes, parsed.dueAt, parsed.priority, now, now],
    );
    if (result.rowsAffected !== 1) {
      throw new Error("任务创建未写入一行");
    }
    const id = parseTaskId(result.lastInsertId);
    const rows = await db.select<TaskRow[]>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`, [id]);
    if (rows.length !== 1) {
      throw new Error("创建后未能读取任务");
    }
    return mapTaskRow(rows[0]);
  }

  async updateStatus(id: number, status: TaskStatus): Promise<void> {
    const taskId = parseTaskId(id);
    const nextStatus = parseTaskStatus(status);
    try {
      await this.command("update_task_status", { id: taskId, status: nextStatus });
    } catch (cause) {
      if (cause === "TASK_NOT_FOUND") throw new TaskNotFoundError(taskId);
      throw cause;
    }
  }

  async setList(id: number, listId: number | null): Promise<void> {
    const taskId = parseTaskId(id);
    const target = listId === null ? null : parseListId(listId);
    const result = await (await this.database()).execute(
      "UPDATE tasks SET updated_at = CASE WHEN list_id IS ? THEN updated_at ELSE ? END, list_id = ? WHERE id = ?",
      [target, this.timestamp(), target, taskId],
    );
    if (result.rowsAffected === 0) throw new TaskNotFoundError(taskId);
    if (result.rowsAffected !== 1) throw new Error("任务移动影响了多行");
  }

  async delete(id: number): Promise<void> {
    const taskId = parseTaskId(id);
    const result = await (await this.database()).execute("DELETE FROM tasks WHERE id = ?", [taskId]);
    if (result.rowsAffected === 0) throw new TaskNotFoundError(taskId);
    if (result.rowsAffected !== 1) throw new Error("任务删除影响了多行");
    // SQL already committed: a lost wake must not offer a duplicate delete retry.
    await this.command("reconcile_reminders").catch(() => console.error("REMINDER_WAKE_FAILED"));
  }

  private timestamp(): string {
    const date = this.now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new TaskValidationError("系统时间无效");
    }
    return parseTaskTime(date.toISOString());
  }
}

export const taskRepository = isBrowserDebug() ? browserTaskRepository : new TaskRepository();
