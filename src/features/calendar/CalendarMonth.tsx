import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CalendarTask = { id: number; title: string; dueAt: string | null; dueDate?: string | null; status: "todo" | "completed" };

const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function CalendarMonth({ tasks, onTaskClick }: { tasks: CalendarTask[]; onTaskClick?: (id: number, returnTo: HTMLElement) => void }) {
  const [selected, setSelected] = useState(() => new Date());
  const year = selected.getFullYear(), month = selected.getMonth();
  const first = new Date(year, month, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const cells = Math.ceil((offset + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  const dates = Array.from({ length: cells }, (_, index) => new Date(year, month, 1 - offset + index, 12));
  const grouped = new Map<string, CalendarTask[]>();
  for (const task of tasks) {
    if (!task.dueAt && !task.dueDate) continue;
    const due = new Date(task.dueDate ? task.dueDate+"T12:00:00" : task.dueAt!);
    if (!Number.isFinite(due.getTime())) continue;
    const key = dayKey(due);
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }
  const selectedKey = dayKey(selected);
  const selectedTasks = (grouped.get(selectedKey) ?? []).sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  const todayKey = dayKey(new Date());
  const monthLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(selected);
  function moveMonth(delta: number) { setSelected(new Date(year, month + delta, 1, 12)); }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">{monthLabel}</h2>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setSelected(new Date())}>今天</Button><Button variant="outline" size="icon-sm" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft aria-hidden="true" /></Button><Button variant="outline" size="icon-sm" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight aria-hidden="true" /></Button></div>
    </div>
    <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-border bg-card" role="group" aria-label={`${monthLabel}日历`}>
      {weekdays.map((day) => <div key={day} className="border-b border-border bg-muted/50 py-2 text-center text-xs font-medium text-muted-foreground">{day}</div>)}
      {dates.map((date) => {
        const key = dayKey(date), dayTasks = grouped.get(key) ?? [];
        return <div key={key} className={`min-h-20 border-b border-r border-border p-1 sm:min-h-24 sm:p-2 ${date.getMonth() === month ? "" : "bg-muted/30 text-muted-foreground"}`}>
          <button type="button" aria-label={`${key}，${dayTasks.length} 项任务${key === selectedKey ? "，已选中" : ""}`} aria-pressed={key === selectedKey} aria-current={key === todayKey ? "date" : undefined} onClick={() => setSelected(date)} className={`flex size-7 items-center justify-center rounded-full text-sm hover:bg-accent ${key === selectedKey ? "bg-primary text-primary-foreground hover:bg-primary" : key === todayKey ? "ring-1 ring-primary" : ""}`}>{date.getDate()}</button>
          {dayTasks.length > 0 && <div className="mt-1 space-y-1">{dayTasks.slice(0, 2).map(task => onTaskClick ? <button key={task.id} type="button" aria-label={`打开任务：${task.title}`} title={task.title} className="block w-full truncate rounded bg-secondary px-1 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" onClick={(event) => onTaskClick(task.id, event.currentTarget)}>{task.title}</button> : <span key={task.id} className="block truncate rounded bg-secondary px-1 text-xs">{task.title}</span>)}{dayTasks.length > 2 && <span className="block text-xs text-muted-foreground">另 {dayTasks.length - 2} 项</span>}</div>}
        </div>;
      })}
    </div>
    <section aria-label={`${selectedKey}任务`} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="font-semibold">{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(selected)} · {selectedTasks.length} 项任务</h3>
      {selectedTasks.length === 0 ? <p className="text-sm text-muted-foreground">这一天没有设置截止时间的任务。</p> : <ul className="divide-y divide-border">{selectedTasks.map((task) => <li key={task.id} className="flex items-center gap-3 py-2 text-sm"><span className="w-12 shrink-0 text-muted-foreground">{task.dueDate?"全天":new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(task.dueAt!))}</span>{onTaskClick ? <button type="button" className={`min-w-0 flex-1 truncate text-left hover:underline ${task.status === "completed" ? "text-muted-foreground line-through" : ""}`} onClick={(event) => onTaskClick(task.id, event.currentTarget)}>{task.title}</button> : <span className={`min-w-0 flex-1 truncate ${task.status === "completed" ? "text-muted-foreground line-through" : ""}`}>{task.title}</span>}</li>)}</ul>}
    </section>
  </div>;
}
