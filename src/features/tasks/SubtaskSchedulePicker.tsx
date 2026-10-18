import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { AlarmClock, ChevronDown, ChevronLeft, ChevronRight, Circle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Subtask, SubtaskSchedule } from "@/domain/subtask";
import { fromLocalInput, toLocalInput } from "@/domain/taskDates";

const dateKey = (date: Date) => `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const firstOfMonth = (date: Date, offset = 0) => { const next = new Date(date); next.setDate(1); next.setMonth(next.getMonth() + offset); return next; };

export function subtaskDateLabel(item: Subtask) {
  const local = item.dueAt ? toLocalInput(item.dueAt) : item.dueDate;
  if (!local) return "";
  return `${Number(local.slice(5, 7))}月${Number(local.slice(8, 10))}日${item.dueAt ? ` ${local.slice(11, 16)}` : ""}`;
}

export function SubtaskSchedulePicker({ item, onChange }: { item: Subtask; onChange: (schedule: SubtaskSchedule) => void }) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger render={<Button variant="ghost" size="icon-xs" aria-label={`设置子任务日期：${item.title}`} title={subtaskDateLabel(item) || "设置日期"} className={item.dueDate || item.dueAt ? "text-primary" : "text-muted-foreground"} />}>
      <AlarmClock className="size-3.5" />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-[60]">
        <Popover.Popup data-task-popover aria-label="子任务日期" className="max-h-[var(--available-height)] w-[304px] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
          <ScheduleForm item={item} onApply={schedule => { onChange(schedule); setOpen(false); }} />
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}

function ScheduleForm({ item, onApply }: { item: Subtask; onApply: (schedule: SubtaskSchedule) => void }) {
  const initial = item.dueAt ? toLocalInput(item.dueAt) : "";
  const today = dateKey(new Date());
  const [date, setDate] = useState(item.dueDate || initial.slice(0, 10) || today);
  const [month, setMonth] = useState(() => new Date(`${date}T12:00:00`));
  const [time, setTime] = useState(initial.slice(11, 16) || "09:00");
  const [timeOpen, setTimeOpen] = useState(!!initial);
  const [error, setError] = useState("");
  const start = firstOfMonth(month);
  start.setDate(1 - (start.getDay() + 6) % 7);
  const cells = Array.from({ length: 42 }, (_, index) => { const value = new Date(start); value.setDate(start.getDate() + index); return value; });
  function save() {
    try {
      onApply(timeOpen ? { dueAt: fromLocalInput(`${date}T${time}`)! } : { dueDate: date });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "日期无效，请重新选择。"); }
  }
  return <div className="space-y-3">
    <Popover.Title className="sr-only">子任务日期</Popover.Title>
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{month.getFullYear()}年{month.getMonth() + 1}月</span>
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon-xs" aria-label="子任务上个月" disabled={month.getFullYear() <= 1 && month.getMonth() === 0} onClick={() => setMonth(firstOfMonth(month, -1))}><ChevronLeft className="size-3.5" /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="子任务回到今天" title="回到今天" onClick={() => { setDate(today); setMonth(new Date()); }}><Circle className="size-2" /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="子任务下个月" disabled={month.getFullYear() >= 9999 && month.getMonth() === 11} onClick={() => setMonth(firstOfMonth(month, 1))}><ChevronRight className="size-3.5" /></Button>
      </div>
    </div>
    <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
      {["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day} className="pb-1 text-muted-foreground">{day}</span>)}
      {cells.map(day => {
        const key = dateKey(day), selected = key === date;
        return <button key={key} type="button" aria-label={key} aria-pressed={selected} disabled={day.getFullYear() < 1 || day.getFullYear() > 9999} onClick={() => { setDate(key); setMonth(day); setError(""); }} className={`mx-auto size-8 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-primary font-medium text-primary-foreground" : key === today ? "bg-secondary font-medium" : day.getMonth() !== month.getMonth() ? "text-muted-foreground/45 hover:bg-accent" : "hover:bg-accent"}`}>
          {day.getDate()}
        </button>;
      })}
    </div>
    <div className="space-y-2 border-t pt-2">
      <button type="button" aria-label="子任务时间" aria-expanded={timeOpen} className="flex min-h-8 w-full items-center gap-2 rounded-md px-1 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setTimeOpen(!timeOpen)}>
        <Clock className="size-4" /><span className="flex-1 text-left">{timeOpen ? time : "时间"}</span><ChevronDown className={`size-3.5 transition-transform ${timeOpen ? "rotate-180" : "-rotate-90"}`} />
      </button>
      {timeOpen && <div className="flex items-center gap-2 pb-1 pl-7">
        {(["小时", "分钟"] as const).map((label, part) => <label key={label} className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
          <select aria-label={`子任务${label}`} value={time.split(":")[part]} className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={event => { const parts = time.split(":"); parts[part] = event.target.value; setTime(parts.join(":")); setError(""); }}>
            {Array.from({ length: part === 0 ? 24 : 60 }, (_, n) => { const value = String(n).padStart(2, "0"); return <option key={value} value={value}>{value}</option>; })}
          </select>{part === 0 ? "时" : "分"}
        </label>)}
      </div>}
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="grid grid-cols-2 gap-2">
      <Button size="sm" onClick={save}>确定</Button><Button size="sm" variant="outline" onClick={() => onApply({})}>清除</Button>
    </div>
  </div>;
}
