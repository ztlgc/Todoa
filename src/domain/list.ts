export interface TaskList {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export class ListValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListValidationError";
  }
}

export function parseListId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ListValidationError("清单 ID 必须是正安全整数");
  }
  return value;
}

export function parseListName(value: unknown): string {
  if (typeof value !== "string") throw new ListValidationError("清单名称必须是文本");
  const name = value.trim();
  if (!name.length || [...name].length > 100) throw new ListValidationError("清单名称长度必须为 1 至 100 个字符");
  return name;
}
