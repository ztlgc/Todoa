import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { browserTaskRepository } from "@/data/browserRepositories";
import { parseCreateTaskInput, type Task } from "@/domain/task";
import { parseDateKey, type JournalItem } from "@/domain/journal";
import { JournalConflictError, journalRepository, type JournalRepository } from "./JournalRepository";

export function findFollowUp(tasks: Task[], _date: string, item: JournalItem) {
  return tasks.find(task => !task.deletedAt && task.id === item.followUpTaskId && task.createdAt === item.followUpTaskCreatedAt);
}
const messages: Record<string, string> = {
  FOLLOW_UP_IN_TRASH: "跟进任务在任务回收站，请先恢复。",
  JOURNAL_NOT_FOUND: "原日记不存在或在回收站，请先恢复。",
  JOURNAL_ITEM_NOT_FOUND: "原工作事项已变更，请重新读取日记。",
  INVALID_FOLLOW_UP: "请先保存有效的下一步跟进事项。",
  JOURNAL_TRANSACTION_FAILED: "日记正在写入，请稍后重试。",
};
export class JournalFollowUpRepository {
  private pending = new Map<string, Promise<number>>();
  private created = new Map<string, Task>();
  constructor(private browser = isBrowserDebug, private browserTasks: Pick<typeof browserTaskRepository, "list" | "create"> = browserTaskRepository, private journal: Pick<JournalRepository, "list" | "save"> = journalRepository, private command: typeof invoke = invoke) {}
  create(date: string, item: JournalItem): Promise<number> {
    const key = `${parseDateKey(date)}:${item.id}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const operation = this.persist(date, item.id, key).finally(() => this.pending.delete(key));
    this.pending.set(key, operation);
    return operation;
  }
  private async persist(date: string, itemId: string, key: string): Promise<number> {
    if (!this.browser()) {
      try { return await this.command<number>("create_journal_follow_up", { date, itemId }); }
      catch (cause) { throw Object.assign(new Error(messages[String(cause)] ?? "跟进未能保存，请重试。"), { cause }); }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const record = (await this.journal.list()).find(record => record.kind === "day" && record.start === date && !record.deletedAt);
      const item = record?.items.find(item => item.id === itemId);
      if (!record || !item) throw new Error("请先保存这条工作记录，再创建跟进。");
      const tasks = [...await this.browserTasks.list(), ...await this.browserTasks.list({ deleted: true })];
      const existing = tasks.find(task => task.id === item.followUpTaskId && task.createdAt === item.followUpTaskCreatedAt);
      if (existing?.deletedAt) throw new Error(messages.FOLLOW_UP_IN_TRASH);
      if (existing) return existing.id;
      let task = this.created.get(key);
      if (task && tasks.some(value => value.id === task!.id && value.createdAt === task!.createdAt && value.deletedAt)) throw new Error(messages.FOLLOW_UP_IN_TRASH);
      if (task && !tasks.some(value => value.id === task!.id && value.createdAt === task!.createdAt)) { this.created.delete(key); task = undefined; }
      if (!task) {
        if (!item.nextAction?.trim()) throw new Error(messages.INVALID_FOLLOW_UP);
        const input = parseCreateTaskInput({ title: [...`${item.client ? `${item.client} · ` : ""}${item.nextAction}`].slice(0, 500).join(""),
          notes: `来源：工作日记 ${date}\n原事项：${item.title}${item.client ? `\n客户：${item.client}` : ""}${item.business ? `\n业务：${item.business}` : ""}${item.notes ? `\n沟通与进展：${item.notes}` : ""}`,
          dueAt: item.followUpAt ?? null, priority: item.important ? "high" : "none" });
        task = await this.browserTasks.create(input);
        this.created.set(key, task);
      }
      const linked = { ...item, followUpTaskId: task.id, followUpTaskCreatedAt: task.createdAt };
      try {
        await this.journal.save({ ...record, items: record.items.map(value => value.id === itemId ? linked : value) }, record.revision);
        this.created.delete(key);
        return task.id;
      } catch (cause) { if (!(cause instanceof JournalConflictError) || attempt === 2) throw cause; }
    }
    throw new Error("跟进关联暂时未能保存，请重试。");
  }
}
export const journalFollowUpRepository = new JournalFollowUpRepository();
