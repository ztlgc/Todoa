import type { JSONContent } from "@tiptap/react";
import { dateKey, journalPeriod, type JournalItem, type JournalKind, type JournalRecord } from "./journal";
import { plainDocument, plainText } from "./contentDocument";

const nodes = new Set(["doc", "paragraph", "text", "hardBreak", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "horizontalRule", "image"]);
const marks = new Set(["bold", "italic", "underline", "strike", "highlight", "code", "link"]);
export function parseJournalDocument(value: unknown): { doc: JSONContent; json: string; text: string; assets: number[] } {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof json !== "string" || new TextEncoder().encode(json).length > 2_000_000) throw new Error("日记内容超过长度限制。");
  const doc: JSONContent = JSON.parse(json), assets = new Set<number>();
  function visit(node: JSONContent, depth: number) {
    if (!node || typeof node !== "object" || depth > 64 || !nodes.has(node.type ?? "")) throw new Error("日记内容格式无效。");
    if (node.type === "text" && (typeof node.text !== "string" || node.text.includes("\0"))) throw new Error("日记文字无效。");
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) throw new Error("日记文字格式无效。");
      for (const mark of node.marks) {
        if (!marks.has(mark.type ?? "")) throw new Error("日记文字格式无效。");
        if (mark.type === "link" && (typeof mark.attrs?.href !== "string" || !/^(https?:\/\/|mailto:)/.test(mark.attrs.href))) throw new Error("链接地址无效。");
      }
    }
    if (node.type === "image") {
      const src = node.attrs?.src;
      const id = typeof src === "string" && /^todoa-asset:\d+$/.test(src) ? Number(src.slice(12)) : NaN;
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("日记图片无效。");
      assets.add(id);
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new Error("日记内容格式无效。");
      node.content.forEach(child => visit(child, depth + 1));
    }
  }
  if (doc?.type !== "doc") throw new Error("日记内容格式无效。");
  visit(doc, 0);
  const text = plainText(doc);
  if (text.length > 200000 || text.includes("\0")) throw new Error("日记内容超过长度限制。");
  return { doc, json, text, assets: [...assets] };
}
export function journalDocument(record?: JournalRecord): JSONContent {
  if (record?.contentJson) return parseJournalDocument(record.contentJson).doc;
  const legacy = record?.items.filter(item => item.origin !== "task_auto").map(item => [
    [item.client, item.title].filter(Boolean).join(" · "), item.notes,
    item.nextAction ? `下一步：${item.nextAction}${item.followUpAt ? `（${new Date(item.followUpAt).toLocaleString("zh-CN")}）` : ""}` : "",
  ].filter(Boolean).join("\n")) ?? [];
  return plainDocument([record?.title, record?.text, ...legacy].filter(Boolean).join("\n\n"));
}
export function completedJournalTasks(record?: JournalRecord): JournalItem[] {
  return (record?.items ?? []).filter(item => item.origin === "task_auto" || (!!item.taskId && !!item.completedAt && dateKey(new Date(item.completedAt)) === record?.start))
    .sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? "") || a.id.localeCompare(b.id));
}
export const journalKindLabel: Record<JournalKind, string> = { day: "日记", week: "历史周总结", month: "历史月总结", year: "历史年度总结" };
export function periodJournalRecords(records: JournalRecord[], kind: JournalKind, anchor: string): JournalRecord[] {
  const period = journalPeriod(kind, anchor);
  return records.filter(record => record.kind === "day" && !record.deletedAt && record.start >= period.start && record.start <= period.end)
    .sort((a, b) => b.start.localeCompare(a.start));
}
export function journalSearchText(record: JournalRecord): string {
  return [record.start, journalKindLabel[record.kind], plainText(journalDocument(record)), ...completedJournalTasks(record).flatMap(item => [item.title, item.notes])].join("\n");
}
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/[\\`*_[\]]/g, "\\$&");
export async function documentMarkdown(doc: JSONContent, image: (id: number) => Promise<string>): Promise<string> {
  const images = new Map<number, Promise<string>>();
  function readImage(id: number) {
    let pending = images.get(id);
    if (!pending) { pending = image(id); images.set(id, pending); }
    return pending;
  }
  const codeText = (node: JSONContent): string => node.type === "hardBreak" ? "\n" : (node.text ?? "") + (node.content ?? []).map(codeText).join("");
  async function render(node: JSONContent): Promise<string> {
    if (node.type === "codeBlock") {
      const text = codeText(node), longest = (text.match(/`+/g) ?? []).reduce((max, value) => Math.max(max, value.length), 0);
      const fence = "`".repeat(Math.max(3, longest + 1));
      return fence + String(node.attrs?.language ?? "").replace(/[^a-z0-9_-]/gi, "") + "\n" + text + (text.endsWith("\n") ? "" : "\n") + fence + "\n\n";
    }
    const children = await Promise.all((node.content ?? []).map(render)), body = children.join("");
    switch (node.type) {
      case "text": {
        let text = escape(node.text ?? "");
        for (const mark of node.marks ?? []) {
          if (mark.type === "bold") text = `**${text}**`;
          if (mark.type === "italic") text = `*${text}*`;
          if (mark.type === "strike") text = `~~${text}~~`;
          if (mark.type === "code") text = "`" + (node.text ?? "").replace(/`/g, "\\`") + "`";
          if (mark.type === "underline") text = `<u>${text}</u>`;
          if (mark.type === "highlight") text = `<mark>${text}</mark>`;
          if (mark.type === "link") text = `[${text}](${String(mark.attrs?.href ?? "").replace(/\)/g, "%29")})`;
        }
        return text;
      }
      case "image": return `![${escape(String(node.attrs?.alt ?? "日记图片"))}](${await readImage(Number(String(node.attrs?.src).slice(12)))})\n\n`;
      case "paragraph": return body + "\n\n";
      case "heading": return "#".repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 2))) + " " + body + "\n\n";
      case "hardBreak": return "  \n";
      case "blockquote": return body.trimEnd().split("\n").map(line => "> " + line).join("\n") + "\n\n";
      case "bulletList": case "orderedList": return children.map((child, index) => {
        const content = child.replace(/\n+$/, "").split("\n");
        const marker = node.type === "bulletList" ? "- " : `${index + (Number(node.attrs?.start) || 1)}. `;
        return marker + content[0] + content.slice(1).map(line => "\n" + " ".repeat(marker.length) + line).join("");
      }).join("\n") + "\n\n";
      case "horizontalRule": return "---\n\n";
      default: return body;
    }
  }
  return (await render(doc)).trimEnd();
}
