import { ArrowUpRight, CalendarCheck2 } from "lucide-react";
import type { JournalItem } from "@/domain/journal";
import type { Task } from "@/domain/task";

export function AutomaticTaskEntries({ items, tasks = [], onOpenTask }: { items: JournalItem[]; tasks?: Task[]; onOpenTask?: (task: Task) => void }) {
  if (!items.length) return null;
  return <section className="jp-auto-section" aria-label="自动完成记录">
    <div className="jp-material-heading"><strong><CalendarCheck2 size={16} />今日完成 · 自动记录</strong><span>{items.filter(item => !item.revokedAt).length} 项{items.some(item => item.revokedAt) ? ` · ${items.filter(item => item.revokedAt).length} 项已撤销` : ""}</span></div>
    {items.map(item => {
      const task = tasks.find(task => task.id === item.taskId && task.createdAt === item.taskCreatedAt);
      return <article className={`jp-auto-item ${item.revokedAt ? "jp-auto-revoked" : ""}`} key={item.id}>
        <div className="jp-auto-item-heading"><h3>{item.title}</h3><time>{new Date(item.completedAt!).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div>
        {item.notes && (item.notes.length > 160 ? <details className="jp-long-notes"><summary>{item.notes.slice(0, 95)}…<span>展开备注</span></summary><p>{item.notes}</p></details> : <p className="jp-item-notes">{item.notes}</p>)}
        {item.revokedAt && <p className="jp-revoked-note">完成已撤销 · {new Date(item.revokedAt).toLocaleString("zh-CN")}</p>}
        <footer><span>{item.theme || "任务完成记录"}{item.important ? " · 重点" : ""}</span>{task && onOpenTask && <button type="button" onClick={() => onOpenTask(task)}>查看原任务<ArrowUpRight size={12} /></button>}</footer>
      </article>;
    })}
  </section>;
}
