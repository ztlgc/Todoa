// Todoa's versioned recurrence format lives in the existing repeat_rule column.
// Legacy text rules remain supported by naturalTaskInput and the Rust scheduler.
export interface RecurrenceRule {
  v: 1;
  basis: "due" | "completion" | "dates";
  frequency: "day" | "week" | "month" | "year";
  interval: number;
  anchor: string;
  weekdays: number[]; // ISO Monday=1 ... Sunday=7
  monthMode: "dates" | "ordinal" | "workday";
  monthDays: number[]; // -1 means last day
  ordinal: number; // -1 means last
  weekday: number;
  workday: "first" | "last";
  month: number;
  dates: string[];
  skipWeekends: boolean;
  end: "never" | "date" | "count";
  endDate: string | null;
  count: number; // Remaining occurrences, including the current one
}
export const dateKey = (d: Date) => `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayDate = (s: string) => new Date(`${s}T12:00:00`);
export const validRecurrenceDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && s.slice(0, 4) !== "0000" && Number.isFinite(dayDate(s).getTime()) && dateKey(dayDate(s)) === s;
const integer = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
const numbers = (a: unknown, min: number, max: number, last = false): a is number[] => Array.isArray(a) && a.length > 0 && a.length <= max - min + 1 + Number(last) && new Set(a).size === a.length && a.every(n => integer(n, min, max) || (last && n === -1));
export function isRecurrenceRule(value: unknown): value is RecurrenceRule {
  if (!value || typeof value !== "object") return false;
  const r = value as RecurrenceRule;
  return r.v === 1 && ["due", "completion", "dates"].includes(r.basis) && ["day", "week", "month", "year"].includes(r.frequency)
    && integer(r.interval, 1, 999) && validRecurrenceDate(r.anchor) && numbers(r.weekdays, 1, 7)
    && ["dates", "ordinal", "workday"].includes(r.monthMode) && numbers(r.monthDays, 1, 31, true)
    && (integer(r.ordinal, 1, 5) || r.ordinal === -1) && integer(r.weekday, 1, 7)
    && ["first", "last"].includes(r.workday) && integer(r.month, 1, 12)
    && Array.isArray(r.dates) && r.dates.length <= 366 && r.dates.every(validRecurrenceDate) && new Set(r.dates).size === r.dates.length
    && (r.basis !== "dates" || (r.dates.length > 0 && r.dates.every(d => d >= r.anchor)))
    && typeof r.skipWeekends === "boolean" && ["never", "date", "count"].includes(r.end)
    && (r.endDate === null || validRecurrenceDate(r.endDate)) && (r.end !== "date" || (r.endDate !== null && r.endDate >= r.anchor)) && integer(r.count, 1, 9999);
}
export function parseRecurrence(rule: string): RecurrenceRule | null {
  if (!rule.startsWith("{")) return null;
  try { const parsed: unknown = JSON.parse(rule); return isRecurrenceRule(parsed) ? parsed : null; } catch { return null; }
}
export function defaultRecurrence(anchor: string): RecurrenceRule {
  const d = dayDate(anchor);
  return { v: 1, basis: "due", frequency: "week", interval: 1, anchor, weekdays: [d.getDay() || 7], monthMode: "dates", monthDays: [d.getDate()], ordinal: 1, weekday: d.getDay() || 7, workday: "first", month: d.getMonth() + 1, dates: [], skipWeekends: false, end: "never", endDate: null, count: 10 };
}
export function editRecurrence(rule: string, anchor: string): RecurrenceRule {
  const parsed = parseRecurrence(rule);
  if (parsed) return { ...parsed, anchor };
  const r = defaultRecurrence(anchor);
  const [kind, amount, day] = rule.split(":");
  if (["day", "week", "month", "year"].includes(kind)) { r.frequency = kind as RecurrenceRule["frequency"]; r.interval = Number(amount); }
  if (kind === "weekday" || kind === "weekend" || kind === "week-monday") r.weekdays = kind === "weekday" ? [1, 2, 3, 4, 5] : kind === "weekend" ? [6, 7] : [1];
  if (kind === "month-last" || kind === "month-day") { r.frequency = "month"; r.monthDays = [kind === "month-last" ? -1 : Number(amount)]; }
  if (kind === "year-date") { r.frequency = "year"; r.month = Number(amount); r.monthDays = [Number(day)]; }
  return r;
}
const weekdays = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export function recurrenceLabel(r: RecurrenceRule): string {
  const units = { day: "天", week: "周", month: "月", year: "年" };
  let label = `${r.basis === "completion" ? "完成后每" : "每"}${r.interval === 1 ? "" : r.interval}${units[r.frequency]}`;
  if (r.basis === "dates") label = `自选 ${r.dates.length} 个日期`;
  else if (r.basis === "due") {
    if (r.frequency === "week") label += ` · ${[...r.weekdays].sort((a,b)=>a-b).map(d=>weekdays[d]).join("、")}`;
    if (r.frequency === "month" || r.frequency === "year") {
      if (r.frequency === "year") label += ` ${r.month}月`;
      label += r.monthMode === "dates" ? ` · ${[...r.monthDays].sort((a,b)=>a-b).map(d=>d === -1 ? "最后一天" : `${d}日`).join("、")}` : r.monthMode === "workday" ? ` · ${r.workday === "first" ? "第一个" : "最后一个"}工作日` : ` · ${r.ordinal === -1 ? "最后一个" : `第${r.ordinal}个`}${weekdays[r.weekday]}`;
      if (r.skipWeekends && r.monthMode === "dates") label += "，跳过周末";
    }
  }
  if (r.end === "date") label += `，至 ${r.endDate}`;
  if (r.end === "count") label += `，共剩 ${r.count} 次`;
  return label;
}
const dayNumber = (d: Date) => { const utc = new Date(0); utc.setUTCFullYear(d.getFullYear(), d.getMonth(), d.getDate()); utc.setUTCHours(0,0,0,0); return utc.getTime() / 86400000; };
const workday = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;
function monthCandidates(r: RecurrenceRule, year: number, month: number): Date[] {
  if (year < 1 || year > 9999) return [];
  const first = dayDate(`${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-01`);
  const last = new Date(first); last.setMonth(last.getMonth()+1); last.setDate(0);
  const make = (n: number) => { const d = new Date(first); d.setDate(n); return d; };
  if (r.monthMode === "dates") return [...new Set(r.monthDays.map(n=>n === -1 ? last.getDate() : n))].filter(n=>n<=last.getDate()).sort((a,b)=>a-b).map(make).filter(d=>!r.skipWeekends || workday(d));
  if (r.monthMode === "workday") { const d = new Date(r.workday === "first" ? first : last); while (!workday(d)) d.setDate(d.getDate() + (r.workday === "first" ? 1 : -1)); return [d]; }
  const n = r.ordinal === -1 ? last.getDate() - ((last.getDay() || 7) - r.weekday + 7) % 7 : 1 + (r.weekday - (first.getDay() || 7) + 7) % 7 + (r.ordinal - 1) * 7;
  return n <= last.getDate() ? [make(n)] : [];
}
export function nextRecurrenceDue(prior: string, r: RecurrenceRule, after = new Date()): string | null {
  if (r.end === "count" && r.count <= 1) return null;
  const previous = new Date(prior), anchor = dayDate(r.anchor);
  if (!Number.isFinite(previous.getTime()) || !Number.isFinite(after.getTime())) return null;
  const cutoff = r.basis === "completion" ? after : new Date(Math.max(previous.getTime(), after.getTime()));
  const clock = r.basis === "completion" ? after : previous;
  const accept = (d: Date): string | null => {
    if (d.getFullYear() > 9999 || d.getFullYear() < 1 || (r.basis !== "completion" && dateKey(d) < r.anchor) || (r.end === "date" && dateKey(d) > r.endDate!)) return null;
    d.setHours(clock.getHours(),clock.getMinutes(),clock.getSeconds(),clock.getMilliseconds());
    return d > cutoff ? d.toISOString() : null;
  };
  if (r.basis === "completion") {
    const d = new Date(after);
    if (r.frequency === "day" || r.frequency === "week") d.setDate(d.getDate() + r.interval * (r.frequency === "week" ? 7 : 1));
    else { const day=d.getDate(); d.setDate(1); d.setMonth(d.getMonth()+r.interval*(r.frequency === "year" ? 12 : 1)); const last=new Date(d); last.setMonth(last.getMonth()+1); last.setDate(0); d.setDate(Math.min(day,last.getDate())); }
    return accept(d);
  }
  if (r.basis === "dates") {
    for (const key of [...r.dates].sort()) { const due=accept(dayDate(key)); if (due) return due; }
    return null;
  }
  if (r.frequency === "month" || r.frequency === "year") {
    const start = anchor.getFullYear()*12+anchor.getMonth();
    const current = cutoff.getFullYear()*12+cutoff.getMonth();
    const step = r.interval*(r.frequency === "year" ? 12 : 1);
    let index = r.frequency === "year" ? anchor.getFullYear()*12+r.month-1 : start;
    index += Math.max(0,Math.floor((current-index)/step))*step;
    while (Math.floor(index/12)<=9999) {
      if (r.end === "date" && index > Number(r.endDate!.slice(0,4))*12+Number(r.endDate!.slice(5,7))-1) return null;
      for (const d of monthCandidates(r, Math.floor(index/12), index%12+1)) { const due=accept(d); if (due) return due; }
      index += step;
    }
    return null;
  }
  if (r.frequency === "day") {
    const steps=Math.max(0,Math.floor((dayNumber(cutoff)-dayNumber(anchor))/r.interval));
    const d=new Date(anchor); d.setDate(d.getDate()+steps*r.interval);
    for (let n=0;n<2;n++) { const due=accept(new Date(d)); if (due) return due; d.setDate(d.getDate()+r.interval); }
    return null;
  }
  const monday=dayNumber(anchor)-((anchor.getDay() || 7)-1);
  const d=dayDate(dateKey(cutoff)); if (d<anchor) d.setTime(anchor.getTime());
  for (let n=0;n<=r.interval*7+7;n++) {
    if (Math.floor((dayNumber(d)-monday)/7)%r.interval===0 && r.weekdays.includes(d.getDay() || 7)) { const due=accept(new Date(d)); if (due) return due; }
    d.setDate(d.getDate()+1);
  }
  return null;
}
export function advanceRecurrenceRule(rule: string): string {
  const r=parseRecurrence(rule);
  return r?.end === "count" ? JSON.stringify({...r,count:Math.max(1,r.count-1)}) : rule;
}
export function previewRecurrence(r: RecurrenceRule, time = "09:00"): string[] {
  if (!isRecurrenceRule(r)) return [];
  const first = new Date(`${r.anchor}T${time || "09:00"}`);
  const dates: string[] = [];
  let prior=first.toISOString(), current=r;
  // The selected deadline is occurrence 1; preview generated occurrences after it.
  for (let n=0;n<3;n++) { const next=nextRecurrenceDue(prior,current,new Date(prior)); if (!next) break; dates.push(next); prior=next; current={...current,count:Math.max(1,current.count-1)}; }
  return dates;
}
