import { initDatabase } from "@/data/db/initDatabase";
import { isBrowserDebug } from "@/app/browserDebug";
import { browserListRepository } from "@/data/browserRepositories";
import type { SqlDatabase } from "@/data/db/SqlDatabase";
import { ListValidationError, parseListId, parseListName, type TaskList } from "@/domain/list";
import { parseTaskTime } from "@/domain/task";

export interface ListRow {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export class ListNotFoundError extends Error {
  constructor(id: number) {
    super(`清单 ${id} 不存在`);
    this.name = "ListNotFoundError";
  }
}

export function mapListRow(row: ListRow): TaskList {
  if (!Number.isSafeInteger(row.sort_order)) throw new ListValidationError("清单 sort_order 不是安全整数");
  return {
    id: parseListId(row.id), name: parseListName(row.name), sortOrder: row.sort_order,
    createdAt: parseTaskTime(row.created_at), updatedAt: parseTaskTime(row.updated_at),
  };
}

const COLUMNS = "id, name, sort_order, created_at, updated_at";

export class ListRepository {
  constructor(
    private readonly database: () => Promise<SqlDatabase> = initDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<TaskList[]> {
    return (await (await this.database()).select<ListRow[]>(`SELECT ${COLUMNS} FROM lists ORDER BY sort_order ASC, id ASC`, [])).map(mapListRow);
  }

  async create(name: string): Promise<TaskList> {
    const parsed = parseListName(name);
    const now = this.timestamp();
    const db = await this.database();
    const result = await db.execute("INSERT INTO lists (name, created_at, updated_at) VALUES (?, ?, ?)", [parsed, now, now]);
    if (result.rowsAffected !== 1) throw new Error("清单创建未写入一行");
    const id = parseListId(result.lastInsertId);
    const rows = await db.select<ListRow[]>(`SELECT ${COLUMNS} FROM lists WHERE id = ?`, [id]);
    if (rows.length !== 1) throw new Error("创建后未能读取清单");
    return mapListRow(rows[0]);
  }

  async rename(id: number, name: string): Promise<void> {
    const listId = parseListId(id);
    const parsed = parseListName(name);
    const result = await (await this.database()).execute(
      "UPDATE lists SET updated_at = CASE WHEN name = ? THEN updated_at ELSE ? END, name = ? WHERE id = ?",
      [parsed, this.timestamp(), parsed, listId],
    );
    this.checkWrite(result.rowsAffected, listId);
  }

  async delete(id: number): Promise<void> {
    const listId = parseListId(id);
    // FK SET NULL and the existing trigger atomically return tasks to Inbox.
    const result = await (await this.database()).execute("DELETE FROM lists WHERE id = ?", [listId]);
    this.checkWrite(result.rowsAffected, listId);
  }

  private checkWrite(rowsAffected: number, id: number) {
    if (rowsAffected === 0) throw new ListNotFoundError(id);
    if (rowsAffected !== 1) throw new Error("清单写入影响了多行");
  }

  private timestamp(): string {
    const date = this.now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new ListValidationError("系统时间无效");
    return parseTaskTime(date.toISOString());
  }
}

export const listRepository = isBrowserDebug() ? browserListRepository : new ListRepository();
