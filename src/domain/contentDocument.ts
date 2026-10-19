import type { JSONContent } from "@tiptap/react";
import { subtaskText } from "./subtask";

export function plainDocument(text: string): JSONContent {
  return { type: "doc", content: text.split("\n").map(line => ({ type: "paragraph", ...(line ? { content: [{ type: "text", text: line }] } : {}) })) };
}
export function plainText(doc: JSONContent): string {
  const visit = (node: JSONContent): string => (node.text ?? "") + (node.content?.map(visit).join("") ?? "")
    + (["paragraph", "heading", "hardBreak", "listItem"].includes(node.type ?? "") ? "\n" : "");
  return [subtaskText(doc), visit(doc).trimEnd()].filter(Boolean).join("\n");
}
export interface ContentImageStore {
  importImage(file: File): Promise<number>;
  image(asset: number): Promise<Blob>;
}
