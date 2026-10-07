import { initDatabase } from "@/data/db/initDatabase";
import { isBrowserDebug } from "@/app/browserDebug";
import { browserTagRepository } from "@/data/browserRepositories";
import type { SqlDatabase } from "@/data/db/SqlDatabase";
import { parseTagId, parseTagName, TagConflictError, TagValidationError, type Tag, type TaskTag } from "@/domain/tag";
import { parseTaskId, parseTaskTime } from "@/domain/task";

export interface TagRow { id: number; name: string; created_at: string; updated_at: string }
export interface TaskTagRow { task_id: number; tag_id: number }

export class TagNotFoundError extends Error {
  constructor(id: number) { super(`标签 ${id} 不存在`); this.name = "TagNotFoundError"; }
}

export class TaskTagNotFoundError extends Error {
  constructor(taskId: number, tagId: number) {
    super(`任务 ${taskId} 与标签 ${tagId} 的关联不存在`);
    this.name = "TaskTagNotFoundError";
  }
}

export function mapTagRow(row: TagRow): Tag {
  return { id: parseTagId(row.id), name: parseTagName(row.name), createdAt: parseTaskTime(row.created_at), updatedAt: parseTaskTime(row.updated_at) };
}

export function mapTaskTagRow(row: TaskTagRow): TaskTag {
  return { taskId: parseTaskId(row.task_id), tagId: parseTagId(row.tag_id) };
}

const COLUMNS = "id, name, created_at, updated_at";

export class TagRepository {
  constructor(
    private readonly database: () => Promise<SqlDatabase> = initDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<Tag[]> {
    return (await (await this.database()).select<TagRow[]>(`SELECT ${COLUMNS} FROM tags ORDER BY name COLLATE NOCASE ASC, id ASC`, [])).map(mapTagRow);
  }

  async listTaskTags(): Promise<TaskTag[]> {
    return (await (await this.database()).select<TaskTagRow[]>("SELECT task_id, tag_id FROM task_tags ORDER BY task_id ASC, tag_id ASC", [])).map(mapTaskTagRow);
  }

  async create(name: string): Promise<Tag> {
    const parsed = parseTagName(name);
    const date = this.now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TagValidationError("系统时间无效");
    const now = parseTaskTime(date.toISOString());
    const db = await this.database();
    // Only the name conflict is handled; other SQL errors must still reject.
    const result = await db.execute("INSERT INTO tags (name, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING", [parsed, now, now]);
    if (result.rowsAffected === 0) throw new TagConflictError(parsed);
    if (result.rowsAffected !== 1) throw new Error("标签创建未写入一行");
    const id = parseTagId(result.lastInsertId);
    const rows = await db.select<TagRow[]>(`SELECT ${COLUMNS} FROM tags WHERE id = ?`, [id]);
    if (rows.length !== 1) throw new Error("创建后未能读取标签");
    return mapTagRow(rows[0]);
  }

  async rename(id: number, name: string): Promise<void> {
    const tag = parseTagId(id), parsed = parseTagName(name);
    const now = parseTaskTime(this.now().toISOString());
    const result = await (await this.database()).execute("UPDATE OR IGNORE tags SET name = ?, updated_at = ? WHERE id = ?", [parsed, now, tag]);
    if (result.rowsAffected === 0) {
      const rows = await (await this.database()).select<TagRow[]>(`SELECT ${COLUMNS} FROM tags WHERE id = ?`, [tag]);
      if (rows.length === 0) throw new TagNotFoundError(tag);
      throw new TagConflictError(parsed);
    }
    if (result.rowsAffected !== 1) throw new Error("标签重命名影响了多行");
  }

  async assign(taskId: number, tagId: number): Promise<void> {
    const task = parseTaskId(taskId);
    const tag = parseTagId(tagId);
    const result = await (await this.database()).execute(
      "INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?) ON CONFLICT(task_id, tag_id) DO NOTHING", [task, tag],
    );
    if (result.rowsAffected !== 0 && result.rowsAffected !== 1) throw new Error("标签分配影响了多行");
  }

  async remove(taskId: number, tagId: number): Promise<void> {
    const task = parseTaskId(taskId);
    const tag = parseTagId(tagId);
    const result = await (await this.database()).execute("DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?", [task, tag]);
    if (result.rowsAffected === 0) throw new TaskTagNotFoundError(task, tag);
    if (result.rowsAffected !== 1) throw new Error("标签移除影响了多行");
  }

  async delete(id: number): Promise<void> {
    const tag = parseTagId(id);
    const result = await (await this.database()).execute("DELETE FROM tags WHERE id = ?", [tag]);
    if (result.rowsAffected === 0) throw new TagNotFoundError(tag);
    if (result.rowsAffected !== 1) throw new Error("标签删除影响了多行");
  }
}

export const tagRepository = isBrowserDebug() ? browserTagRepository : new TagRepository();
