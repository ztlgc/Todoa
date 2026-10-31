import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { journalImageStore } from "@/data/repositories/JournalContentRepository";
import type { JournalRecord } from "@/domain/journal";
import { completedJournalTasks, documentMarkdown, journalDocument, journalKindLabel } from "@/domain/journalContent";

export async function exportJournalRecords(entries: JournalRecord[], filename: string, heading: string): Promise<string> {
  const sections = [`# ${heading}\n\n`];
  for (const entry of entries) {
    const images = journalImageStore(entry.kind, entry.start);
    const note = await documentMarkdown(journalDocument(entry), async asset => {
      const blob = await images.image(asset);
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("图片导出失败，请重试。")); reader.readAsDataURL(blob);
      });
    });
    const tasks = completedJournalTasks(entry).map(item => `- [${item.revokedAt ? " " : "x"}] ${item.title.replace(/[\r\n]/g, " ")}${item.revokedAt ? "（完成已撤销）" : ""}${item.notes ? "\n  " + item.notes.replace(/\n/g, "\n  ") : ""}`).join("\n");
    sections.push(`## ${entry.start} ${journalKindLabel[entry.kind]}\n\n${entry.kind === "day" && tasks ? `### 已完成任务\n\n${tasks}\n\n` : ""}### ${entry.kind === "day" ? "工作记录" : "回顾正文"}\n\n${note}\n`);
    if (new Blob(sections).size > 32 * 1024 * 1024) throw new Error("导出内容超过 32 MB，请按月导出原始日记，或减少图片后重试。");
  }
  const content = sections.join("\n");
  if (isBrowserDebug()) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); return "已导出。";
  }
  return await invoke<string>("export_journal_markdown", { content, filename }) === "cancelled" ? "已取消导出。" : "已导出。";
}
