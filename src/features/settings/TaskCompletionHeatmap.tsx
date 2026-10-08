import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Task } from "@/domain/task";

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function buildCompletionHeatmap(tasks: Task[], now: Date, year = now.getFullYear()) {
  const todayKey = localDateKey(now);
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.status !== "completed" || !task.completedAt || task.deletedAt) continue;
    const completed = new Date(task.completedAt);
    if (!Number.isFinite(completed.getTime())) continue;
    const key = localDateKey(completed);
    if (key > todayKey) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const months = Array.from({ length: 12 }, (_, month) => {
    const length = new Date(year, month + 1, 0).getDate();
    const days = Array.from({ length }, (_, index) => {
      const date = new Date(year, month, index + 1);
      const key = localDateKey(date);
      return { key, date, count: counts.get(key) ?? 0, future: key > todayKey };
    });
    return { month, days };
  });
  return { months, days: months.flatMap(month => month.days) };
}

const colors = ["bg-muted", "bg-emerald-200 dark:bg-emerald-900", "bg-emerald-400 dark:bg-emerald-700", "bg-emerald-600 dark:bg-emerald-500", "bg-emerald-800 dark:bg-emerald-300"];
const level = (count: number) => count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4;

export function TaskCompletionHeatmap({ tasks, now }: { tasks: Task[]; now: Date }) {
  const [view, setView] = useState<"month" | "year">("year");
  const [period, setPeriod] = useState<{ year: number; month: number } | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const year = period?.year ?? now.getFullYear();
  const month = period?.month ?? now.getMonth();
  const todayKey = localDateKey(now);
  const timezoneOffset = now.getTimezoneOffset();
  const data = useMemo(() => buildCompletionHeatmap(tasks, new Date(`${todayKey}T12:00:00`), year), [tasks, todayKey, year, timezoneOffset]);
  const months = view === "year" ? data.months : [data.months[month]];
  const days = view === "year" ? data.days : months[0].days;
  const selected = days.find(day => day.key === selectedKey) ?? days.find(day => day.key === todayKey) ?? days[0];
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const activeDays = days.filter(day => day.count > 0).length;
  const label = view === "year" ? `${year} 年` : `${year} 年 ${month + 1} 月`;

  function navigate(direction: number) {
    const target = new Date(year + (view === "year" ? direction : 0), month + (view === "month" ? direction : 0), 1);
    setPeriod({ year: target.getFullYear(), month: target.getMonth() });
    setSelectedKey(null);
  }

  return <section aria-labelledby="completion-heatmap-heading" className="min-w-0 rounded-xl border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="completion-heatmap-heading" className="text-base font-semibold">完成热力图</h2><p className="mt-1 text-xs text-muted-foreground">按本地完成日期统计</p></div>
      <div role="group" aria-label="热力图视图" className="flex gap-1 rounded-lg border border-border bg-background p-1">
        {(["month", "year"] as const).map(mode => <Button key={mode} size="sm" variant="ghost" className={view === mode ? "bg-muted text-foreground hover:bg-muted" : "text-muted-foreground"} aria-label={mode === "month" ? "月视图" : "年视图"} aria-pressed={view === mode} onClick={() => {
          if (mode === "month") setPeriod({ year, month: selected.date.getMonth() });
          setView(mode);
        }}>{mode === "month" ? "月" : "年"}</Button>)}
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={view === "year" ? "上一年" : "上个月"} onClick={() => navigate(-1)}><ChevronLeft aria-hidden="true" className="size-4" /></Button>
        <span className="min-w-24 text-center text-sm font-medium tabular-nums">{label}</span>
        <Button variant="ghost" size="icon-sm" aria-label={view === "year" ? "下一年" : "下个月"} onClick={() => navigate(1)}><ChevronRight aria-hidden="true" className="size-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => { setPeriod(null); setSelectedKey(null); }}>{view === "year" ? "今年" : "本月"}</Button>
      </div>
      <p className="text-sm text-muted-foreground">完成 <strong className="font-semibold text-foreground tabular-nums">{total}</strong> 项 · 活跃 <strong className="font-semibold text-foreground tabular-nums">{activeDays}</strong> 天</p>
    </div>
    <div className="mt-5 p-1">
      <div className={view === "year" ? "grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-x-3 gap-y-5" : "w-full"}>
        {months.map(item => <div key={item.month} className="min-w-0">
          {view === "year" && <h3 className="mb-3 text-center text-xs font-medium text-muted-foreground">{item.month + 1}月</h3>}
          <div role="group" aria-label={`${year}年${item.month + 1}月每日完成数量`} className={`grid ${view === "year" ? "grid-cols-[repeat(auto-fill,minmax(10px,1fr))] gap-[2px]" : "grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-2"}`}>
            {item.days.map((day, index) => <button
              key={day.key} type="button" data-date={day.key}
              title={`${day.key}：完成 ${day.count} 项${day.future ? "（未来日期）" : ""}`}
              aria-label={`${day.key}：完成 ${day.count} 项`}
              aria-pressed={selected.key === day.key}
              tabIndex={selected.key === day.key ? 0 : -1}
              className={`${view === "year" ? "aspect-square min-h-[10px] rounded-[3px]" : "aspect-square min-h-8 rounded-md text-xs tabular-nums"} border border-foreground/5 ${colors[level(day.count)]} ${day.count >= 6 ? "text-white dark:text-emerald-950" : "text-foreground"} ${day.future ? "opacity-40" : ""} ${selected.key === day.key ? "ring-1 ring-foreground ring-offset-1 ring-offset-card" : ""} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
              onFocus={() => setSelectedKey(day.key)}
              onClick={() => setSelectedKey(day.key)}
              onKeyDown={event => {
                const grid = event.currentTarget.parentElement!;
                const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(track => /^\d+(\.\d+)?px$/.test(track)).length || (view === "year" ? 5 : 7);
                const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
                const current = view === "year" ? days.findIndex(entry => entry.key === day.key) : index;
                const target = event.key === "Home" ? 0 : event.key === "End" ? days.length - 1 : moves[event.key] === undefined ? null : Math.max(0, Math.min(days.length - 1, current + moves[event.key]));
                if (target === null) return;
                event.preventDefault();
                event.currentTarget.closest("section")?.querySelector<HTMLButtonElement>(`button[data-date="${days[target].key}"]`)?.focus();
              }}
            >{view === "month" ? day.date.getDate() : null}</button>)}
          </div>
        </div>)}
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <p role="status" aria-live="polite">{selected.key}：完成 <span className="font-medium text-foreground tabular-nums">{selected.count}</span> 项{selected.future ? "（未来日期）" : ""}</p>
      <div className="flex items-center gap-1.5" aria-label="颜色依次表示完成 0 项、1 至 2 项、3 至 5 项、6 至 9 项、10 项及以上"><span>少</span>{colors.map((color, index) => <span key={color} title={["0 项", "1–2 项", "3–5 项", "6–9 项", "10 项及以上"][index]} className={`size-[10px] rounded-[3px] ${color}`} />)}<span>多</span></div>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">每天从左到右、再从上到下排列。悬停或点击查看数量；仅计入当前保留且已完成的任务。</p>
  </section>;
}
