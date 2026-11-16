import { dateKey, defaultRecurrence, parseRecurrence, nextRecurrenceDue, recurrenceLabel, validLegacyRepeatRule } from "./recurrence";
import { fromLocalInput } from "./taskDates";
export interface NaturalTaskInput {
  title: string; dueAt: string | null; matchedText: string | null; label: string | null;
  repeatText: string | null; repeatRule: string | null; remindAt: string[]; reminderOffsets: number[];
}
const weekdays: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
function chineseNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return digits[value] ?? NaN;
}
const periods: Record<string, number> = { 早上: 7, 早晨: 7, 上午: 9, 中午: 12, 下午: 13, 傍晚: 17, 晚上: 20, 凌晨: 0 };
const datePattern = /\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[-/.月]\d{1,2}日?|[一二三四五六七八九十两]{1,3}月[一二三四五六七八九十两]{1,3}日?|今天|明天|大后天|后天|今晚|明早|明晚|下周[一二三四五六日天]|本周[一二三四五六日天]|这周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|周[一二三四五六日天]|\d{1,2}月|[一二三四五六七八九十两]{1,3}月|today|tomorrow|tonight/gi;
const timePattern = /(?:上午|早上|早晨|中午|下午|傍晚|晚上|凌晨)?\s*(?:\d{1,2}[:：]\d{2}|[一二三四五六七八九十两\d]{1,3}点(?:半|一刻|三刻|[一二三四五六七八九十两\d]{1,3}分?)?|\d{1,2}\s*(?:am|pm))/i;
const periodPattern = /早上|早晨|上午|中午|下午|傍晚|晚上|凌晨/;
const repeatPattern = /每(?:年|个)\d{1,2}月\d{1,2}日?|每(?:年|个)\d{1,2}月|每月最后[1一]天|每月最1天|每月第?\d{1,2}天|每个工作日|每周末(?:重复)?|每\d{1,3}[天周月年]|每隔\d{1,3}[天周月年]|每周[一二三四五六日天](?:[、,，和](?:周)?[一二三四五六日天])*|每周|每天|每日|每月|每年/;
const advancePattern = /提前(?:(\d{1,3})(分钟|小时|天|周)提醒?|提醒我)/g;
const laterPattern = /(?:(\d{1,3})小时)?(?:(\d{1,3})分(?:钟)?)?(?:之后|以后|后)|(?:(\d{1,3})(天|周|个月|年))(?:之后|以后|后)/g;
const unitMinutes: Record<string, number> = { 分钟: 1, 小时: 60, 天: 1440, 周: 10080 };
function validDate(year: number, month: number, day: number): Date | null {
  if (year < 1 || year > 9999) return null;
  const date = new Date(0); date.setFullYear(year, month - 1, day); date.setHours(12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
function nearestDay(month: number, day: number, now: Date): Date | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let year = now.getFullYear(); year <= now.getFullYear() + 8; year++) {
    const candidate = validDate(year, month, day);
    if (candidate && candidate >= today) return candidate;
  }
  return null;
}
function dateFromPhrase(phrase: string, now: Date): Date | null {
  const full = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(phrase);
  if (full) return validDate(+full[1], +full[2], +full[3]);
  const short = /^(\d{1,2})[-/.月](\d{1,2})/.exec(phrase);
  if (short) return nearestDay(+short[1], +short[2], now);
  const chinese = /^([一二三四五六七八九十两]{1,3})月([一二三四五六七八九十两]{1,3})日?$/.exec(phrase);
  if (chinese) return nearestDay(chineseNumber(chinese[1]), chineseNumber(chinese[2]), now);
  const month = /^(\d{1,2})月$/.exec(phrase);
  if (month) return nearestDay(+month[1], 1, now);
  const chineseMonth = /^([一二三四五六七八九十两]{1,3})月$/.exec(phrase);
  if (chineseMonth) return nearestDay(chineseNumber(chineseMonth[1]), 1, now);
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const relative: Record<string, number> = { 今天: 0, 今晚: 0, 明天: 1, 明早: 1, 明晚: 1, 后天: 2, 大后天: 3, today: 0, tonight: 0, tomorrow: 1 };
  if (phrase.toLowerCase() in relative) { date.setDate(date.getDate() + relative[phrase.toLowerCase()]); return date; }
  const week = /^(下周|本周|这周|周|星期|礼拜)([一二三四五六日天])$/.exec(phrase);
  if (week) {
    let distance = (weekdays[week[2]] - date.getDay() + 7) % 7;
    const current = date.getDay() || 7, target = weekdays[week[2]] || 7;
    if (week[1] === "下周") distance = 7 - current + target;
    if (week[1] === "本周" || week[1] === "这周") {
      if (target < current) return null;
      distance = target - current;
    }
    date.setDate(date.getDate() + distance); return date;
  }
  return null;
}
function timeFromPhrase(phrase: string): { hour: number; minute: number } | null {
  const match = /^(上午|早上|早晨|中午|下午|傍晚|晚上|凌晨)?\s*([一二三四五六七八九十两\d]{1,3})(?:[:：](\d{2})|点(半|一刻|三刻|[一二三四五六七八九十两\d]{1,3}分?)?|\s*(am|pm))$/i.exec(phrase.trim());
  if (!match) return null;
  let hour = chineseNumber(match[2]);
  const minute = match[3] ? +match[3] : match[4] === "半" ? 30 : match[4] === "一刻" ? 15 : match[4] === "三刻" ? 45 : match[4] ? chineseNumber(match[4].replace("分", "")) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const period = match[1] ?? match[5]?.toLowerCase();
  if (period && (hour > 12 || ((period === "am" || period === "pm") && hour < 1))) return null;
  if (period === "中午" && hour < 11) hour += 12;
  if (["下午", "傍晚", "晚上", "pm"].includes(period ?? "") && hour < 12) hour += 12;
  if (["凌晨", "上午", "早上", "早晨", "am"].includes(period ?? "") && hour === 12) hour = 0;
  return { hour, minute };
}
function recurrence(text: string, now: Date): string | null {
  if (text === "每天" || text === "每日") return "day:1";
  if (text === "每周") return "week-monday";
  if (text === "每个工作日") return "weekday";
  if (text === "每周末重复" || text === "每周末") return "weekend";
  const weekly = /^每周([一二三四五六日天](?:[、,，和](?:周)?[一二三四五六日天])*)$/.exec(text);
  if (weekly) return JSON.stringify({ ...defaultRecurrence(dateKey(now)), weekdays: [...new Set(weekly[1].split(/[、,，和]/).map(day => weekdays[day.replace(/^周/, "")] || 7))] });
  if (text === "每月最后1天" || text === "每月最后一天" || text === "每月最1天") return "month-last";
  const nth = /^每月第?(\d{1,2})天$/.exec(text);
  if (nth) return `month-day:${+nth[1]}`;
  const yearDate = /^每(?:年|个)(\d{1,2})月(\d{1,2})日?$/.exec(text);
  if (yearDate) return `year-date:${+yearDate[1]}:${+yearDate[2]}`;
  const yearMonth = /^每(?:年|个)(\d{1,2})月$/.exec(text);
  if (yearMonth) return `year-date:${+yearMonth[1]}:1`;
  const interval = /^每(?:隔)?(\d{1,3})(天|周|月|年)$/.exec(text);
  if (interval) return `${{ 天: "day", 周: "week", 月: "month", 年: "year" }[interval[2]]}:${+interval[1]}`;
  if (text === "每月") return "month:1";
  if (text === "每年") return "year:1";
  return null;
}
function addCalendar(date: Date, amount: number, unit: string): Date {
  const result = new Date(date);
  if (unit === "个月" || unit === "年") {
    const day = result.getDate(); result.setDate(1);
    if (unit === "个月") result.setMonth(result.getMonth() + amount); else result.setFullYear(result.getFullYear() + amount);
    result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
  } else result.setDate(result.getDate() + amount * (unit === "周" ? 7 : 1));
  return result;
}
const label = (date: Date) => date.toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
export function parseNaturalTaskInput(input: string, now = new Date()): NaturalTaskInput {
  const unchanged = (): NaturalTaskInput => ({ title: input.trim(), dueAt: null, matchedText: null, label: null, repeatText: null, repeatRule: null, remindAt: [], reminderOffsets: [] });
  if (!Number.isFinite(now.getTime()) || now.getFullYear() < 1 || now.getFullYear() > 9999) return unchanged();
  let rest = input;
  const repeatMatch = repeatPattern.exec(rest), repeatText = repeatMatch?.[0] ?? null;
  if (repeatMatch && /^每周[一二三四五六日天]/.test(repeatMatch[0]) && /^[至到]/.test(rest.slice(repeatMatch.index + repeatMatch[0].length))) return unchanged();
  const repeatRule = repeatText ? recurrence(repeatText, now) : null;
  if (repeatRule && !parseRecurrence(repeatRule) && !validLegacyRepeatRule(repeatRule)) return unchanged();
  if (repeatMatch && repeatRule) rest = rest.slice(0, repeatMatch.index) + " " + rest.slice(repeatMatch.index + repeatText!.length);
  const offsets: number[] = [];
  rest = rest.replace(advancePattern, (_matched, quantity: string | undefined, unit: string | undefined) => { offsets.push(quantity && unit ? +quantity * unitMinutes[unit] : 5); return " "; });
  if (offsets.length) offsets.unshift(0);
  let due: Date | null = null, matchedText: string | null = null;
  let hasCalendarDate = false;
  const later = [...rest.matchAll(laterPattern)].find(match => match[1] || match[2] || match[3]);
  if (later) {
    due = later[3] ? addCalendar(now, +later[3], later[4]) : new Date(now.getTime() + ((+(later[1] ?? 0) * 60) + +(later[2] ?? 0)) * 60000);
    matchedText = later[0]; offsets.push(0);
    rest = rest.slice(0, later.index) + " " + rest.slice((later.index ?? 0) + later[0].length);
  } else {
    for (const match of rest.matchAll(datePattern)) {
      if (match.index > 0 && /[\d./-]/.test(rest[match.index - 1])) continue;
      if (/\d/.test(rest[match.index + match[0].length] ?? "")) return unchanged();
      const date = dateFromPhrase(match[0], now);
      if (!date) return unchanged();
      hasCalendarDate = true;
      const start = match.index; let end = start + match[0].length;
      const after = rest.slice(end);
      if (/^T\d/.test(after)) return unchanged();
      const separator = /^\s*(?:的|于|在|,|，)?\s*/.exec(after)?.[0] ?? "";
      const timeMatch = timePattern.exec(after.slice(separator.length));
      if (timeMatch && timeMatch.index > 0 && /\d/.test(after.slice(separator.length)[timeMatch.index - 1])) return unchanged();
      const periodMatch = periodPattern.exec(after.slice(separator.length));
      const time = timeMatch?.index === 0 ? timeFromPhrase(timeMatch[0]) : null;
      if (timeMatch?.index === 0 && !time) return unchanged();
      if (timeMatch?.index === 0 && /[:：\d]/.test(after.slice(separator.length)[timeMatch[0].length] ?? "")) return unchanged();
      if (time) { date.setHours(time.hour, time.minute, 0, 0); end += separator.length + timeMatch![0].length; }
      else if (periodMatch?.index === 0) { date.setHours(periods[periodMatch[0]], 0, 0, 0); end += separator.length + periodMatch[0].length; }
      else date.setHours(match[0] === "今晚" || match[0] === "明晚" ? 20 : match[0] === "明早" ? 7 : 12, 0, 0, 0);
      if (time && (date.getHours() !== time.hour || date.getMinutes() !== time.minute)) return unchanged();
      if (date <= now && /^(?:周|星期|礼拜)[一二三四五六日天]$/.test(match[0])) date.setDate(date.getDate() + 7);
      if (date <= now && /^(?:\d{1,2}月(?:\d{1,2}日?)?|[一二三四五六七八九十两]{1,3}月(?:[一二三四五六七八九十两]{1,3}日?)?)$/.test(match[0])) {
        const next = nearestDay(date.getMonth() + 1, date.getDate(), new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
        if (next) { next.setHours(date.getHours(), date.getMinutes(), 0, 0); due = next; }
      }
      due ??= date; matchedText = rest.slice(start, end).trim(); rest = rest.slice(0, start) + " " + rest.slice(end); break;
    }
  }
  if (!due) {
    const timeMatch = timePattern.exec(rest), periodMatch = periodPattern.exec(rest);
    const time = timeMatch ? timeFromPhrase(timeMatch[0]) : null;
    if (timeMatch && !time) return unchanged();
    if (timeMatch && ((timeMatch.index > 0 && /\d/.test(rest[timeMatch.index - 1])) || /[:：\d]/.test(rest[timeMatch.index + timeMatch[0].length] ?? ""))) return unchanged();
    const chosen = time ? timeMatch : periodMatch;
    if (chosen) {
      due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time?.hour ?? periods[chosen[0]], time?.minute ?? 0);
      if (time && (due.getHours() !== time.hour || due.getMinutes() !== time.minute)) return unchanged();
      if (due <= now) due.setDate(due.getDate() + 1);
      matchedText = chosen[0]; rest = rest.slice(0, chosen.index) + " " + rest.slice((chosen.index ?? 0) + chosen[0].length);
    }
  }
  if (repeatRule && !hasCalendarDate && !later) {
    due ??= new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const hour = due.getHours(), minute = due.getMinutes();
    const structured = parseRecurrence(repeatRule);
    if (due <= now) due.setDate(due.getDate() + 1);
    if (structured) {
      while (!structured.weekdays.includes(due.getDay() || 7)) due.setDate(due.getDate() + 1);
    }
    if (repeatRule === "week-monday") { due.setDate(due.getDate() + (1 - due.getDay() + 7) % 7); if (due <= now) due.setDate(due.getDate() + 7); }
    if (repeatRule === "weekday" || repeatRule === "weekend") {
      const valid = (d: number) => repeatRule === "weekday" ? d >= 1 && d <= 5 : d === 0 || d === 6;
      if (due <= now) due.setDate(due.getDate() + 1);
      while (!valid(due.getDay())) due.setDate(due.getDate() + 1);
    }
    if (repeatRule === "month-last") { due = new Date(now.getFullYear(), now.getMonth() + 1, 0, hour, minute); if (due <= now) due = new Date(now.getFullYear(), now.getMonth() + 2, 0, hour, minute); }
    if (repeatRule.startsWith("month-day:")) {
      const day = +repeatRule.split(":")[1];
      due = new Date(now.getFullYear(), now.getMonth(), Math.min(day, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()), hour, minute);
      if (due <= now) due = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(day, new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate()), hour, minute);
    }
    if (repeatRule.startsWith("year-date:")) { const [, month, day] = repeatRule.split(":").map(Number); due = nearestDay(month, day, now); due?.setHours(hour, minute, 0, 0); if (due && due <= now) { due = nearestDay(month, day, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)); due?.setHours(hour, minute, 0, 0); } }
  }
  if (due) {
    try { if (fromLocalInput(`${dateKey(due)}T${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`) === null) return unchanged(); } catch { return unchanged(); }
  }
  const title = rest.replace(/^[\s,，、]+|[\s,，、]+$/g, "").replace(/\s+/g, " ");
  if (due && /提醒我/.test(rest)) offsets.push(0);
  const reminderOffsets = [...new Set(offsets)];
  if (reminderOffsets.length > 16 || reminderOffsets.some(offset => offset > 525600) || (reminderOffsets.length && !due)) return unchanged();
  const remindAt = due ? reminderOffsets.map(minutes => new Date(due!.getTime() - minutes * 60000).toISOString()) : [];
  return { title, dueAt: due?.toISOString() ?? null, matchedText, label: due ? label(due) : null, repeatText, repeatRule, remindAt, reminderOffsets };
}
export function nextRepeatDue(prior: string, rule: string, after = new Date()): string | null {
  const structured = parseRecurrence(rule);
  if (structured) return nextRecurrenceDue(prior, structured, after);
  const date = new Date(prior);
  if (!validLegacyRepeatRule(rule) || !Number.isFinite(date.getTime()) || !Number.isFinite(after.getTime())) return null;
  const cutoff = new Date(Math.max(date.getTime(), after.getTime()));
  if (/^(day|week):/.test(rule)) {
    const [frequency, interval] = rule.split(":");
    return nextRecurrenceDue(prior, { ...defaultRecurrence(dateKey(date)), frequency: frequency as "day" | "week", interval: Number(interval) }, cutoff);
  }
  while (date.getFullYear() <= 9999) {
    const [kind, first, second] = rule.split(":");
    const day = date.getDate();
    if (kind === "day" || kind === "week") date.setDate(day + Number(first) * (kind === "week" ? 7 : 1));
    else if (kind === "month" || kind === "year") {
      date.setDate(1);
      if (kind === "month") date.setMonth(date.getMonth() + Number(first)); else date.setFullYear(date.getFullYear() + Number(first));
      date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
    } else if (kind === "week-monday") date.setDate(day + (8 - (date.getDay() || 7)));
    else if (kind === "weekday" || kind === "weekend") {
      do { date.setDate(date.getDate() + 1); } while (kind === "weekday" ? [0, 6].includes(date.getDay()) : ![0, 6].includes(date.getDay()));
    } else if (kind === "month-last" || kind === "month-day") {
      date.setDate(1); date.setMonth(date.getMonth() + 1);
      date.setDate(kind === "month-last" ? new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() : Math.min(Number(first), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
    } else if (kind === "year-date") {
      let year = date.getFullYear(), candidate: Date | null = null;
      while (year <= 9999) {
        candidate = validDate(year, Number(first), Number(second));
        if (candidate && dateKey(candidate) > dateKey(date)) break;
        candidate = null; year++;
      }
      if (!candidate) return null;
      date.setFullYear(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());
    } else return null;
    if (date.getFullYear() > 9999) return null;
    if (date > cutoff) return date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999 ? date.toISOString() : null;
  }
  return null;
}
export function repeatRuleLabel(rule: string): string {
  const structured = parseRecurrence(rule);
  if (structured) return recurrenceLabel(structured);
  if (rule === "week-monday") return "每周一";
  if (rule === "weekday") return "每个工作日";
  if (rule === "weekend") return "每周末";
  if (rule === "month-last") return "每月最后一天";
  const [kind, first, second] = rule.split(":");
  if (kind === "month-day") return `每月第${first}天`;
  if (kind === "year-date") return `每年${first}月${second}日`;
  const unit: Record<string, string> = { day: "天", week: "周", month: "月", year: "年" };
  return kind in unit ? `每${Number(first) === 1 ? "" : first}${unit[kind]}` : rule;
}
