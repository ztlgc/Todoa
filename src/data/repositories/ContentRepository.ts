import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { browserTaskRepository } from "@/data/browserRepositories";
import { parseTaskNotes, parseTaskTitle } from "@/domain/task";
import type { JSONContent } from "@tiptap/react";
import { subtaskText } from "@/domain/subtask";

const images = new Map<number, { blob: Blob; tasks: Set<number> }>();
let sequence = 0;
export function plainDocument(text: string): JSONContent {
  return {
    type: "doc",
    content: text
      .split("\n")
      .map((line) => ({
        type: "paragraph",
        ...(line ? { content: [{ type: "text", text: line }] } : {}),
      })),
  };
}
export function plainText(doc: JSONContent): string {
  const visit = (n: JSONContent): string =>
    (n.text ?? "") +
    (n.content?.map(visit).join("") ?? "") +
    (["paragraph", "heading", "hardBreak", "listItem"].includes(n.type ?? "")
      ? "\n"
      : "");
  return [subtaskText(doc), visit(doc).trimEnd()].filter(Boolean).join("\n");
}
export const contentRepository = {
  async save(id: number, title: string, doc: JSONContent, revision: number) {
    const json = JSON.stringify(doc);
    const parsedTitle = parseTaskTitle(title);
    const notes = parseTaskNotes(plainText(doc));
    if (json.length > 2000000)
      throw new Error("标题或内容超出长度限制。");
    if (!isBrowserDebug())
      return invoke<number>("save_task_content", { id, title: parsedTitle, json, revision });
    const task = await browserTaskRepository.getById(id);
    if (!task || (task.contentRevision ?? 0) !== revision)
      throw new Error("CONTENT_CONFLICT");
    await browserTaskRepository.update(id, { title: parsedTitle, notes });
    Object.assign(task, { contentJson: json, contentRevision: revision + 1 });
    return revision + 1;
  },
  async importImage(id: number, file: File): Promise<number> {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    )
      throw new Error("请选择不超过 10MB 的 PNG、JPEG 或 WebP 图片。");
    const bitmap = await createImageBitmap(file);
    const tooLarge = bitmap.width * bitmap.height > 40_000_000;
    bitmap.close();
    if (tooLarge) throw new Error("图片尺寸过大，请缩小后再插入。");
    if (isBrowserDebug()) {
      const asset = ++sequence;
      images.set(asset, { blob: file, tasks: new Set([id]) });
      return asset;
    }
    return invoke<number>("import_task_image", {
      id,
      mime: file.type,
      data: Array.from(new Uint8Array(await file.arrayBuffer())),
    });
  },
  async image(id: number, asset: number): Promise<Blob> {
    if (isBrowserDebug()) {
      const value = images.get(asset);
      if (!value) throw new Error("图片不存在");
      return value.blob;
    }
    const [mime, data] = await invoke<[string, number[]]>("read_task_image", {
      id,
      asset,
    });
    return new Blob([new Uint8Array(data)], { type: mime });
  },
};
