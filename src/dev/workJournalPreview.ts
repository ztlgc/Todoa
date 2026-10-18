import { isTauri } from "@tauri-apps/api/core";
import { browserListRepository, browserTaskRepository } from "@/data/browserRepositories";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { journalPeriod, parseJournalInput, type JournalInput } from "@/domain/journal";
import fixture from "../../docs/fixtures/work-journal-real-work.json";

// This entry is only served by Vite through work-journal-test.html. It is not
// part of either packaged application entry, and never accesses desktop data.
async function prepare() {
  if (!import.meta.env.DEV || isTauri()) throw new Error("工作日记样本仅供本地浏览器测试使用。");

  // Read and validate existing storage before creating anything. Existing
  // records (including edits and trash) always win over the sample dataset.
  const stored = await journalRepository.list();
  const inputs: JournalInput[] = [];
  const lists = new Map<string, number>();
  for (const name of fixture.lists) {
    const list = await browserListRepository.create(name);
    lists.set(name, list.id);
  }

  for (const day of fixture.days) {
    const items = [];
    for (const [index, entry] of day.items.entries()) {
      const createdAt = new Date(`${day.date}T08:${String(index).padStart(2, "0")}:00+08:00`).toISOString();
      const completedAt = entry.source === "completed"
        ? new Date(`${day.date}T${[11, 14, 17][index]}:00:00+08:00`).toISOString()
        : null;
      const task = entry.source === "manual" ? null : await browserTaskRepository.create({
        title: entry.title,
        notes: entry.notes,
        listId: lists.get(day.theme),
        dueAt: new Date(`${day.date}T17:30:00+08:00`).toISOString(),
        priority: entry.important ? "high" : entry.source === "todo" ? "medium" : "none",
      });
      if (task) {
        // Deliberately synthetic source timestamps; no system clock changes.
        // Stable creation identity keeps saved snapshots bound after reload.
        Object.assign(task, { createdAt, updatedAt: completedAt ?? createdAt,
          status: entry.source === "completed" ? "completed" : "todo", completedAt });
      }
      items.push({ id: `real-work-${entry.id}`, title: entry.title, notes: entry.notes,
        theme: entry.theme, important: entry.important, taskId: task?.id ?? null,
        taskCreatedAt: task ? createdAt : null, completedAt });
    }
    inputs.push(parseJournalInput({ ...journalPeriod("day", day.date), title: day.title,
      text: day.text, theme: day.theme, important: day.important, items }));
  }
  for (const summary of fixture.summaries) {
    inputs.push(parseJournalInput({ ...summary, kind: summary.kind as JournalInput["kind"], items: [] }));
  }

  let added = 0;
  const conflicts: string[] = [];
  for (const input of inputs) {
    const existing = stored.find(record => record.kind === input.kind && record.start === input.start);
    if (existing) {
      if (existing.title !== input.title) conflicts.push(input.start);
      continue;
    }
    await journalRepository.save(input, 0);
    added++;
  }
  const status = document.getElementById("fixture-status");
  if (status) status.textContent = `已准备 40 个配套任务、10 篇日记（60 条工作进展）及 4 篇阶段总结。本次新增 ${added} 篇；已有记录保留。${conflicts.length ? `以下日期已有不同内容：${conflicts.join("、")}。` : ""}点击下方“日记”查看。`;
}

try {
  await prepare();
} catch (cause) {
  const status = document.getElementById("fixture-status");
  if (status) {
    status.setAttribute("role", "alert");
    status.textContent = `样本载入未完成：${cause instanceof Error ? cause.message : "请检查本地存储后重试。"}已有日记未被替换。`;
  }
}
await import("../windows/main");
