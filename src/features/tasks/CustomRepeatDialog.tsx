import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { dateKey, editRecurrence, isRecurrenceRule, previewRecurrence, recurrenceLabel, validRecurrenceDate, type RecurrenceRule } from "@/domain/recurrence";

const selectClass = "h-8 min-w-0 rounded-lg border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const weekNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export function CustomRepeatDialog({ rule, date, time, onApply, onClosed }: {
  rule: string; date: string; time: string; onApply: (rule: string) => void; onClosed: () => void;
}) {
  const [draft, setDraft] = useState(() => editRecurrence(rule, date || dateKey(new Date())));
  const [dateDraft, setDateDraft] = useState("");
  const [error, setError] = useState("");
  const change = <K extends keyof RecurrenceRule>(key: K, value: RecurrenceRule[K]) => { setDraft(d => ({ ...d, [key]: value })); setError(""); };
  const toggle = (key: "weekdays" | "monthDays", n: number) => change(key, draft[key].includes(n) ? draft[key].filter(v => v !== n) : [...draft[key], n]);
  const previews = previewRecurrence(draft, time);
  const valid = isRecurrenceRule(draft);
  return <Dialog open onOpenChange={open => { if (!open) onClosed(); }}>
    <DialogContent className="max-h-[92dvh] gap-3 overflow-y-auto p-4 sm:max-w-[340px]">
      <DialogTitle className="text-sm">自定义重复</DialogTitle>
      <label className="grid gap-1.5 text-xs text-muted-foreground">安排方式
        <select className={selectClass} aria-label="重复计算方式" value={draft.basis} onChange={e => change("basis", e.target.value as RecurrenceRule["basis"])}>
          <option value="due">按计划日期</option><option value="completion">从完成时刻开始</option><option value="dates">指定多个日期</option>
        </select>
      </label>
      {draft.basis !== "dates" && <div className="flex items-center gap-2 text-xs">
        <span>每隔</span>
        <Input aria-label="重复间隔" type="number" min="1" max="999" className="h-8 min-w-0 flex-1" value={draft.interval || ""} onChange={e => change("interval", Number(e.target.value))} />
        <select aria-label="重复单位" className={`${selectClass} flex-1`} value={draft.frequency} onChange={e => change("frequency", e.target.value as RecurrenceRule["frequency"])}>
          <option value="day">天</option><option value="week">周</option><option value="month">月</option><option value="year">年</option>
        </select>
      </div>}
      {draft.basis === "due" && draft.frequency === "week" && <div className="space-y-2">
        <p className="text-xs text-muted-foreground">选择星期，可多选</p>
        <div role="group" aria-label="重复星期" className="grid grid-cols-7 gap-1">
          {weekNames.map((name, i) => <button key={name} type="button" aria-label={`每${name}`} aria-pressed={draft.weekdays.includes(i + 1)} className={`h-8 rounded-lg text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${draft.weekdays.includes(i + 1) ? "bg-primary text-primary-foreground" : "bg-muted/60 hover:bg-accent"}`} onClick={() => toggle("weekdays", i + 1)}>{name.slice(1)}</button>)}
        </div>
      </div>}
      {draft.basis === "due" && ["month", "year"].includes(draft.frequency) && <div className="space-y-2.5">
        {draft.frequency === "year" && <label className="flex items-center justify-between gap-2 text-xs">月份
          <select aria-label="重复月份" className={`${selectClass} w-32`} value={draft.month} onChange={e => change("month", Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}月</option>)}</select>
        </label>}
        <div role="group" aria-label="月内重复方式" className="flex gap-1 rounded-lg bg-muted/70 p-1">
          {([["dates", "指定日期"], ["ordinal", "星期顺序"], ["workday", "工作日"]] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={draft.monthMode === mode} className={`h-7 flex-1 rounded-md text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${draft.monthMode === mode ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => change("monthMode", mode)}>{label}</button>)}
        </div>
        {draft.monthMode === "dates" && <>
          <div role="group" aria-label="重复月内日期" className="grid grid-cols-7 gap-1">
            {[...Array.from({ length: 31 }, (_, i) => i + 1), -1].map(n => <button key={n} type="button" aria-label={n === -1 ? "每月最后一天" : `每月${n}日`} aria-pressed={draft.monthDays.includes(n)} className={`h-7 rounded-md text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${n === -1 ? "col-span-3" : ""} ${draft.monthDays.includes(n) ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`} onClick={() => toggle("monthDays", n)}>{n === -1 ? "最后一天" : n}</button>)}
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.skipWeekends} onChange={e => change("skipWeekends", e.target.checked)} />跳过周六、周日</label>
        </>}
        {draft.monthMode === "ordinal" && <div className="grid grid-cols-2 gap-2">
          <select aria-label="星期序号" className={selectClass} value={draft.ordinal} onChange={e => change("ordinal", Number(e.target.value))}>{[1, 2, 3, 4, 5, -1].map(n => <option key={n} value={n}>{n === -1 ? "最后一个" : `第${n}个`}</option>)}</select>
          <select aria-label="指定星期" className={selectClass} value={draft.weekday} onChange={e => change("weekday", Number(e.target.value))}>{weekNames.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select>
        </div>}
        {draft.monthMode === "workday" && <select aria-label="工作日位置" className={`${selectClass} w-full`} value={draft.workday} onChange={e => change("workday", e.target.value as RecurrenceRule["workday"])}><option value="first">第一个工作日</option><option value="last">最后一个工作日</option></select>}
        <p className="text-[11px] leading-relaxed text-muted-foreground">{draft.monthMode === "workday" ? "工作日仅按周一至周五判断，不校正节假日或调休。" : draft.monthMode === "dates" ? "无此日期的月份会跳过；选择最后一天可覆盖月末。" : "没有第5个指定星期的月份会跳过。"}</p>
      </div>}
      {draft.basis === "dates" && <div className="space-y-2">
        <div className="flex gap-2"><Input aria-label="添加重复日期" type="date" min={draft.anchor} value={dateDraft} onChange={e => setDateDraft(e.target.value)} className="h-8 min-w-0 flex-1" /><Button size="sm" variant="outline" onClick={() => {
          if (!validRecurrenceDate(dateDraft) || dateDraft < draft.anchor || draft.dates.length >= 366) { setError("请选择开始日期之后的有效日期，最多366个。"); return; }
          change("dates", [...new Set([...draft.dates, dateDraft])].sort()); setDateDraft("");
        }}>加入</Button></div>
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">{draft.dates.map(d => <Button key={d} size="sm" variant="secondary" aria-label={`移除日期${d}`} onClick={() => change("dates", draft.dates.filter(v => v !== d))}>{d} ×</Button>)}</div>
      </div>}
      <div className="space-y-2 border-t pt-3">
        <label className="flex items-center justify-between gap-2 text-xs">何时结束
          <select aria-label="重复结束方式" className={`${selectClass} w-40`} value={draft.end} onChange={e => change("end", e.target.value as RecurrenceRule["end"])}><option value="never">持续重复</option><option value="date">到指定日期</option><option value="count">达到次数</option></select>
        </label>
        {draft.end === "date" && <Input className="h-8" aria-label="重复结束日期" type="date" min={draft.anchor} value={draft.endDate ?? ""} onChange={e => change("endDate", e.target.value || null)} />}
        {draft.end === "count" && <label className="flex items-center gap-2 text-xs"><Input className="h-8 w-24" aria-label="重复总次数" type="number" min="1" max="9999" value={draft.count || ""} onChange={e => change("count", Number(e.target.value))} />次（包含当前任务）</label>}
      </div>
      <div aria-live="polite" className="space-y-1.5 rounded-lg bg-muted/50 p-2.5 text-xs">
        <p className="font-medium">{valid ? recurrenceLabel(draft) : "请完善重复条件"}</p>
        <p className="text-[11px] text-muted-foreground">当前任务之后的安排{draft.basis === "completion" ? "（假设在计划时刻完成）" : ""}</p>
        {previews.length ? <ol className="space-y-1 tabular-nums">{previews.map(d => <li key={d}>{dateKey(new Date(d))}{time ? ` ${time}` : ""}</li>)}</ol> : <p className="text-muted-foreground">无后续日期</p>}
        <p className="text-[11px] text-muted-foreground">当前任务日期：{draft.anchor}。完成当前任务后生成下一项。</p>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" onClick={onClosed}>取消</Button><Button size="sm" onClick={() => { if (!valid) { setError("请检查间隔、日期和结束条件；星期或日期至少选择一个。"); return; } onApply(JSON.stringify(draft)); }}>应用重复</Button></div>
    </DialogContent>
  </Dialog>;
}
