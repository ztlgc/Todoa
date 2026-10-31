import { expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { emptyJournal, type JournalRecord } from "./journal";
import { plainDocument } from "./contentDocument";
import { documentMarkdown, journalDocument, parseJournalDocument } from "./journalContent";

it("preserves previous handwritten fields without adding automatic tasks to the note", () => {
  const record: JournalRecord = { ...emptyJournal("day", "2026-10-18"), title: "走访记录", text: "资金归集方案", revision: 1, createdAt: "", updatedAt: "", deletedAt: null, items: [
    { id: "old", title: "客户反馈", notes: "财务确认", client: "甲公司", nextAction: "下周回访", taskId: null, completedAt: null, theme: "", important: false },
    { id: "auto", origin: "task_auto", title: "完成材料提交", notes: "任务备注", taskId: 1, completedAt: "2026-10-18T01:00:00.000Z", theme: "", important: false },
  ] };
  const text = parseJournalDocument(journalDocument(record)).text;
  expect(text).toContain("资金归集方案"); expect(text).toContain("甲公司 · 客户反馈"); expect(text).toContain("财务确认"); expect(text).toContain("下周回访"); expect(text).not.toContain("完成材料提交");
  expect(journalDocument({ ...record, contentJson: JSON.stringify(plainDocument("新的完整补充")) })).toEqual(plainDocument("新的完整补充"));
});
it("validates notes and exports formatting, links, lists and owned images", async () => {
  const doc = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "重点", marks: [{ type: "bold" }] }, { type: "text", text: "官网", marks: [{ type: "link", attrs: { href: "https://example.com/" } }] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "下次回访" }] }] }] },
    { type: "image", attrs: { src: "todoa-asset:12", alt: "沟通材料" } },
  ] };
  expect(parseJournalDocument(doc).assets).toEqual([12]);
  const output = await documentMarkdown(doc, async () => "data:image/png;base64,test");
  expect(output).toContain("**重点**"); expect(output).toContain("[官网](https://example.com/)"); expect(output).toContain("- 下次回访"); expect(output).toContain("data:image/png;base64,test");
  expect(() => parseJournalDocument({ type: "doc", content: [{ type: "image", attrs: { src: "https://external/image.png" } }] })).toThrow();
  expect(() => parseJournalDocument({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:bad()" } }] }] }] })).toThrow();
});

it.each([1, 4, 8])("exports nested lists at depth %s with one image read and correct indentation", async depth => {
  let node: JSONContent = { type: "image", attrs: { src: "todoa-asset:12" } };
  for (let index = 0; index < depth; index++) node = { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: `层${index}` }] }, node] }] };
  const read = vi.fn(async () => "data:image/png;base64,test");
  const result = await documentMarkdown({ type: "doc", content: [node] }, read);
  expect(read).toHaveBeenCalledExactlyOnceWith(12);
  expect(result.match(/data:image/g)).toHaveLength(1);
  expect(result).toContain(" ".repeat(depth * 2) + "![");
});

it("shares one image read across repeated nodes and indents multi-digit ordered lists", async () => {
  const image = { type: "image", attrs: { src: "todoa-asset:12" } };
  const read = vi.fn(async () => "data:image/png;base64,test");
  const doc = { type: "doc", content: [{ type: "orderedList", attrs: { start: 10 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }, image, image] }] }] };
  const result = await documentMarkdown(doc, read);
  expect(read).toHaveBeenCalledTimes(1);
  expect(result).toContain("10. 正文"); expect(result).toContain("    ![");
  expect(result.match(/data:image/g)).toHaveLength(2);
});

it.each(["第一行\n第二行  \n", "  缩进\n\n", "包含 ``` 围栏", "末尾空格  "])("preserves code-block whitespace and fences: %j", async text => {
  const output = await documentMarkdown({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text }] }] }, async () => "");
  const fence = text.includes("```") ? "````" : "```";
  expect(output).toBe(fence + "\n" + text + (text.endsWith("\n") ? "" : "\n") + fence);
});
