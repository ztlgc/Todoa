export interface Tag {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTag {
  taskId: number;
  tagId: number;
}

export class TagValidationError extends Error {
  constructor(message: string) { super(message); this.name = "TagValidationError"; }
}

export class TagConflictError extends Error {
  constructor(name: string) { super(`标签“${name}”已存在`); this.name = "TagConflictError"; }
}

export function parseTagId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TagValidationError("标签 ID 必须是正安全整数");
  }
  return value;
}

export function parseTagName(value: unknown): string {
  if (typeof value !== "string") throw new TagValidationError("标签名称必须是文本");
  if (value.includes("\0") || /[\uD800-\uDFFF]/u.test(value)) throw new TagValidationError("标签名称包含无效字符");
  const name = value.trim();
  if (!name.length || [...name].length > 100) throw new TagValidationError("标签名称长度必须为 1 至 100 个字符");
  return name;
}
