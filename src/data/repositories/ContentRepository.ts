import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { browserTaskRepository } from "@/data/browserRepositories";
import { parseTaskNotes, parseTaskTitle } from "@/domain/task";
import type { JSONContent } from "@tiptap/react";
import { plainText } from "@/domain/contentDocument";
import { validateImageFile } from "@/data/imageFiles";
export { plainDocument, plainText } from "@/domain/contentDocument";

const images = new Map<number, { blob: Blob; tasks: Set<number> }>();
let sequence = 0;
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
    await validateImageFile(file);
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
