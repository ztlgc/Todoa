import { parseDateKey } from "./journal";

export type JournalHighlight = {
  id: string; date: string; summary: string; result: string; theme: string;
  sourceType: "note" | "task" | "legacy"; sourceId: string; sourceRevision: number;
  revision: number; createdAt: string; updatedAt: string; deletedAt: string | null;
  sourceDeleted: boolean; sourceChanged: boolean; sourceRevoked: boolean;
};
export type HighlightInput = Pick<JournalHighlight, "id" | "date" | "summary" | "result" | "theme" | "sourceType" | "sourceId" | "sourceRevision">;
export type JournalReviewMaterial = {
  sourceType: "highlight" | "month"; sourceId: string; snapshot: string;
  sourceDeleted: boolean; sourceChanged: boolean; sourceRevoked: boolean;
};
export function parseHighlightInput(input: HighlightInput): HighlightInput {
  const text = (value: string, max: number, required = false) => {
    if (typeof value !== "string") throw new Error("重点格式无效。");
    const trimmed = value.trim();
    if (trimmed.includes("\0") || trimmed.length > max || (required && !trimmed)) throw new Error("重点文字为空或超过长度限制。");
    return trimmed;
  };
  if (!["note", "task", "legacy"].includes(input.sourceType) || !Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 0 || (input.sourceType === "task" && input.sourceRevision !== 0)) throw new Error("重点来源或版本无效。");
  return { id: text(input.id, 100, true), date: parseDateKey(input.date), summary: text(input.summary, 20000, true), result: text(input.result, 20000), theme: text(input.theme, 100), sourceType: input.sourceType, sourceId: text(input.sourceId, 100, true), sourceRevision: input.sourceRevision };
}
export function highlightSnapshot(item: Pick<JournalHighlight, "date" | "summary" | "result" | "theme">): string {
  return [`${item.date} · ${item.summary}`, item.result ? `结果：${item.result}` : "", item.theme ? `主题：${item.theme}` : "", `来源：${item.date} 日记重点`].filter(Boolean).join("\n");
}
