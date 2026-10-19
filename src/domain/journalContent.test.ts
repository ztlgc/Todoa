import { expect, it } from "vitest";
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
