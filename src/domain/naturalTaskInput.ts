export interface NaturalTaskInput {
  title: string;
  dueAt: string | null;
  matchedText: string | null;
  label: string | null;
  repeatText: string | null;
}

const WEEKDAY: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const DATE_PATTERN = /(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[-/.月]\d{1,2}日?|今天|明天|后天|大后天|今晚|明早|明晚|下周[一二三四五六日天]|本周[一二三四五六日天]|这周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|周[一二三四五六日天]|\d{1,3}天后|\b(?:today|tomorrow|tonight|next\s+(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?|(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?)\b)/gi;
const TIME_PATTERN = /(?:上午|早上|早晨|中午|下午|傍晚|晚上|凌晨)?\s*(?:\d{1,2}[:：]\d{2}|\d{1,2}点(?:半|一刻|三刻|\d{1,2}分?)?|\d{1,2}\s*(?:am|pm))/i;
const EN_WEEKDAY: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const REPEAT_PATTERN = /(?:每隔\d{1,3}[天周月年]|每(?:天|日|晚|早|周[一二三四五六日天]?|星期[一二三四五六日天]?|月(?:\d{1,2}[日号])?|年(?:\d{1,2}月\d{1,2}[日号])?)|工作日|\bevery\s+(?:day|weekday|week|month|year|(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?)\b)/i;

function validDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function dateFromPhrase(phrase: string, now: Date): Date | null {
  const lower = phrase.toLowerCase();
  const full = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(phrase);
  if (full) return validDate(+full[1], +full[2], +full[3]);
  const short = /^(\d{1,2})[-/.月](\d{1,2})/.exec(phrase);
  if (short) {
    const thisYear = validDate(now.getFullYear(), +short[1], +short[2]);
    if (!thisYear) return null;
    return thisYear.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      ? validDate(now.getFullYear() + 1, +short[1], +short[2]) : thisYear;
  }
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const relative: Record<string, number> = { 今天: 0, 今晚: 0, 明天: 1, 明早: 1, 明晚: 1, 后天: 2, 大后天: 3, today: 0, tonight: 0, tomorrow: 1 };
  if (lower in relative) { date.setDate(date.getDate() + relative[lower]); return date; }
  const later = /^(\d{1,3})天后$/.exec(phrase);
  if (later) { date.setDate(date.getDate() + +later[1]); return date; }
  const zhWeek = /^(下周|本周|这周|周|星期|礼拜)([一二三四五六日天])$/.exec(phrase);
  if (zhWeek) {
    const target = WEEKDAY[zhWeek[2]];
    const mondayOffset = (date.getDay() + 6) % 7;
    const dayOffset = (target + 6) % 7;
    let distance = dayOffset - mondayOffset;
    if (zhWeek[1] === "下周") distance += 7;
    else if (zhWeek[1] === "周" || zhWeek[1] === "星期" || zhWeek[1] === "礼拜") { if (distance < 0) distance += 7; }
    else if (distance < 0) return null;
    date.setDate(date.getDate() + distance);
    return date;
  }
  const enWeek = /^(next\s+)?(mon|tue|wed|thu|fri|sat|sun)(?:day)?$/.exec(lower);
  if (enWeek) {
    let distance = (EN_WEEKDAY[enWeek[2]] - date.getDay() + 7) % 7;
    if (enWeek[1]) distance = distance === 0 ? 7 : distance;
    date.setDate(date.getDate() + distance);
    return date;
  }
  return null;
}

function timeFromPhrase(phrase: string): { hour: number; minute: number } | null {
  const match = /^(上午|早上|早晨|中午|下午|傍晚|晚上|凌晨)?\s*(\d{1,2})(?:[:：](\d{2})|点(半|一刻|三刻|\d{1,2}分?)?|\s*(am|pm))$/i.exec(phrase.trim());
  if (!match) return null;
  let hour = +match[2];
  const minute = match[3] ? +match[3] : match[4] === "半" ? 30 : match[4] === "一刻" ? 15 : match[4] === "三刻" ? 45 : match[4] ? +match[4].replace("分", "") : 0;
  if (hour > 23 || minute > 59) return null;
  const period = match[1] ?? match[5]?.toLowerCase();
  if (period === "下午" || period === "傍晚" || period === "晚上" || period === "pm") { if (hour < 12) hour += 12; }
  if (period === "凌晨" || period === "上午" || period === "早上" || period === "早晨" || period === "am") { if (hour === 12) hour = 0; }
  return { hour, minute };
}

export function parseNaturalTaskInput(input: string, now = new Date()): NaturalTaskInput {
  const repeatMatch = REPEAT_PATTERN.exec(input);
  const repeatText = repeatMatch?.[0] ?? null;
  for (const match of input.matchAll(DATE_PATTERN)) {
    if (match.index > 0 && /[\d./-]/.test(input[match.index - 1])) continue;
    if (repeatMatch && match.index >= repeatMatch.index && match.index < repeatMatch.index + repeatMatch[0].length) continue;
    const phrase = match[0];
    const date = dateFromPhrase(phrase, now);
    if (!date) continue;
    let start = match.index;
    let end = start + phrase.length;
    const before = input.slice(Math.max(0, start - 12), start);
    const after = input.slice(end, end + 18);
    const adjacent = /^\s*(?:的|于|在|,|，)?\s*/.exec(after)?.[0] ?? "";
    const timeMatch = TIME_PATTERN.exec(after.slice(adjacent.length));
    const prefixTime = TIME_PATTERN.exec(before);
    let time: { hour: number; minute: number } | null = null;
    if (timeMatch?.index === 0) {
      time = timeFromPhrase(timeMatch[0]);
      if (time) end += adjacent.length + timeMatch[0].length;
    } else if (prefixTime && prefixTime.index + prefixTime[0].length === before.length) {
      time = timeFromPhrase(prefixTime[0]);
      if (time) start -= prefixTime[0].length;
    }
    if (time) date.setHours(time.hour, time.minute, 0, 0);
    else date.setHours(12, 0, 0, 0);
    const title = input.slice(0, start).concat(" ", input.slice(end)).replace(/\s+/g, " ").trim();
    if (!title) continue;
    const matchedText = input.slice(start, end).trim();
    return { title, dueAt: date.toISOString(), matchedText, label: date.toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }), repeatText };
  }
  const timeOnly = /^(上午|早上|早晨|中午|下午|傍晚|晚上|凌晨)\s*\d{1,2}(?:[:：]\d{2}|点(?:半|一刻|三刻|\d{1,2}分?)?)/.exec(input.trim());
  if (timeOnly) {
    const time = timeFromPhrase(timeOnly[0]);
    const title = input.trim().slice(timeOnly[0].length).trim();
    if (time && title) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.hour, time.minute);
      return { title, dueAt: date.toISOString(), matchedText: timeOnly[0], label: date.toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }), repeatText };
    }
  }
  return { title: input.trim(), dueAt: null, matchedText: null, label: null, repeatText };
}
