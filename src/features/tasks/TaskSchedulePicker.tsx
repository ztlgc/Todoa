import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Bell,
  Repeat2,
  Sun,
  Sunrise,
  CalendarPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Task, UpdateTaskInput } from "@/domain/task";
import { fromLocalInput, toLocalInput } from "@/domain/taskDates";
import { repeatRuleLabel } from "@/domain/naturalTaskInput";
import { CustomRepeatDialog } from "./CustomRepeatDialog";
import { isRecurrenceRule, parseRecurrence } from "@/domain/recurrence";

const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const reminderPresets = [0, 5, 60, 1440, 4320];
const reminderLabel = (minutes: number) =>
  minutes === 0
    ? "准时"
    : minutes % 1440 === 0
      ? `提前${minutes / 1440}天`
      : minutes % 60 === 0
        ? `提前${minutes / 60}小时`
        : `提前${minutes}分钟`;
export function TaskSchedulePicker({
  task,
  onSave,
  onClosed,
}: {
  task: Task;
  onSave: (input: UpdateTaskInput) => Promise<void>;
  onClosed: () => void;
}) {
  const initial = toLocalInput(task.dueAt);
  const [date, setDate] = useState(task.dueDate ?? initial.slice(0, 10));
  const [time, setTime] = useState(initial.slice(11, 16) || "09:00");
  const [timeOpen, setTimeOpen] = useState(false);
  const [draftTime, setDraftTime] = useState("09:00");
  const hourColumn = useRef<HTMLDivElement>(null);
  const minuteColumn = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!timeOpen) return;
    [hourColumn, minuteColumn].forEach((column, part) => {
      if (column.current) {
        column.current.scrollTop = Math.max(0, Math.floor(Number(draftTime.split(":")[part]) / 3) * 36 - 72);
      }
    });
  }, [timeOpen, draftTime]);
  const [month, setMonth] = useState(
    () =>
      new Date(
        `${(task.dueDate ?? initial.slice(0, 10)) || key(new Date())}T12:00:00`,
      ),
  );
  const [repeat, setRepeat] = useState(task.repeatRule ?? "");
  const [offsets, setOffsets] = useState(task.reminderOffsets ?? []);
  const [custom, setCustom] = useState("1");
  const [customUnit, setCustomUnit] = useState("hour");
  const [customRepeatOpen, setCustomRepeatOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12),
    start = (first.getDay() + 6) % 7;
  const cells = Array.from(
    { length: 42 },
    (_, i) =>
      new Date(month.getFullYear(), month.getMonth(), i - start + 1, 12),
  );
  const zone = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  )[0];
  async function save(clear = false) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (zone !== Intl.DateTimeFormat().resolvedOptions().timeZone)
        throw new Error("系统时区已改变，请关闭后重新核对日期。");
      if (!clear && !date && (time || repeat || offsets.length))
        throw new Error("请先选择日期。");
      if (!clear && offsets.length && !time)
        throw new Error("设置提醒前，请明确选择时间。");
      let nextRule = repeat || null;
      const structured = parseRecurrence(repeat);
      if (!clear && structured && date !== (task.dueDate ?? initial.slice(0, 10))) {
        const moved = { ...structured, anchor: date };
        if (!isRecurrenceRule(moved)) throw new Error("日期已改变，请重新核对自定义重复的日期和结束条件。");
        nextRule = JSON.stringify(moved);
      }
      const dueAt =
        clear || !date || !time
          ? null
          : date === initial.slice(0, 10) && time === initial.slice(11, 16)
            ? task.dueAt
            : fromLocalInput(`${date}T${time}`);
      if (
        !clear &&
        dueAt &&
        offsets.some((n) => Date.parse(dueAt) - n * 60000 <= Date.now())
      )
        throw new Error("提醒时间已过去，请调整日期或时间。");
      await onSave({
        dueAt,
        dueDate: clear || !date || time ? null : date,
        repeatRule: clear ? null : nextRule,
        reminderOffsets: clear ? [] : offsets,
      });
      onClosed();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "时间设置未能保存，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  function shortcut(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setDate(key(d));
    setMonth(d);
  }
  function openCustomRepeat() { setCustomRepeatOpen(true); }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClosed();
      }}
    >
      <DialogContent
        className="max-h-[94dvh] gap-2 overflow-y-auto p-3 sm:max-w-[304px]"
        showCloseButton={!busy}
      >
        <DialogTitle className="text-center text-sm">日期与提醒</DialogTitle>
        <div className="flex justify-around border-b pb-1">
          {[
            { n: 0, label: "今天", Icon: Sun },
            { n: 1, label: "明天", Icon: Sunrise },
            { n: 7, label: "下周", Icon: CalendarPlus },
          ].map(({ n, label, Icon }) => (
            <Button
              key={label}
              variant="ghost"
              className="h-auto flex-col gap-0.5 px-3 py-1.5"
              disabled={busy}
              onClick={() => shortcut(n)}
            >
              <Icon className="size-4" />
              <span className="text-xs">{label}</span>
            </Button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="font-medium">
            {month.getFullYear()}年{month.getMonth() + 1}月
          </span>
          <div className="flex">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="上个月"
              disabled={busy}
              onClick={() =>
                setMonth(
                  new Date(month.getFullYear(), month.getMonth() - 1, 1, 12),
                )
              }
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="下个月"
              disabled={busy}
              onClick={() =>
                setMonth(
                  new Date(month.getFullYear(), month.getMonth() + 1, 1, 12),
                )
              }
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
          {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
            <span key={d} className="py-1 text-xs text-muted-foreground">
              {d}
            </span>
          ))}
          {cells.map((d) => (
            <button
              key={key(d)}
              type="button"
              disabled={busy}
              aria-label={key(d)}
              aria-pressed={date === key(d)}
              onClick={() => setDate(key(d))}
              className={`mx-auto size-6 rounded-full hover:bg-accent ${date === key(d) ? "bg-primary text-primary-foreground hover:bg-primary" : key(d) === key(new Date()) ? "bg-secondary font-semibold" : d.getMonth() !== month.getMonth() ? "text-muted-foreground/50" : ""}`}
            >
              {d.getDate()}
            </button>
          ))}
        </div>
        <div className="space-y-2 border-t pt-2">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="size-4 text-muted-foreground" />
            <button
              type="button"
              className="flex h-8 min-w-0 flex-1 items-center justify-between rounded-lg border bg-background px-2.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="截止时间"
              aria-haspopup="dialog"
              aria-expanded={timeOpen}
              disabled={busy}
              onClick={() => {
                setDraftTime(time || "09:00");
                setTimeOpen(true);
              }}
            >
              <span className={time ? "tabular-nums" : "text-muted-foreground"}>{time || "选择时间"}</span>
              <Clock className="size-3.5 text-muted-foreground" />
            </button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setTime("");
                setOffsets([]);
              }}
            >
              无时间
            </Button>
          </div>
          <div className="flex gap-2 text-sm">
            <Bell className="mt-1 size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <span>提醒</span>
              <div className="flex flex-wrap gap-2">
                {reminderPresets.map((n) => (
                  <label key={n} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={offsets.includes(n)}
                      onChange={(e) =>
                        setOffsets(
                          e.target.checked
                            ? [...offsets, n]
                            : offsets.filter((v) => v !== n),
                        )
                      }
                    />
                    {reminderLabel(n)}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="shrink-0 text-xs">提前</span>
                <Input
                  aria-label="自定义提前数量"
                  type="number"
                  min="1"
                  max={customUnit === "day" ? "365" : "8760"}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  disabled={busy}
                  className="h-8 min-w-0 flex-1"
                />
                <ChoiceSelect
                  label="自定义提醒单位"
                  value={customUnit}
                  disabled={busy}
                  className="h-8 px-2 text-xs"
                  onChange={setCustomUnit}
                  options={[{ value: "hour", label: "小时" }, { value: "day", label: "天" }]}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const amount = Number(custom);
                    const n = amount * (customUnit === "day" ? 1440 : 60);
                    if (
                      custom.trim() !== "" &&
                      amount > 0 &&
                      Number.isSafeInteger(n) &&
                      n <= 525600 &&
                      (offsets.includes(n) || offsets.length < 16)
                    ) {
                      setOffsets([...new Set([...offsets, n])]);
                      setError(undefined);
                    } else
                      setError(
                        "请输入有效的提前时间（最多365天，最多16条提醒）。",
                      );
                  }}
                >
                  添加
                </Button>
              </div>
              {offsets.length > 0 && !time && (
                <p className="text-xs text-muted-foreground">
                  已选提醒，请设置日期和时间后保存。
                </p>
              )}
              {offsets.some((n) => !reminderPresets.includes(n)) && (
                <div className="flex flex-wrap gap-1">
                  {offsets
                    .filter((n) => !reminderPresets.includes(n))
                    .map((n) => (
                      <Button
                        key={n}
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          setOffsets(offsets.filter((v) => v !== n))
                        }
                      >
                        {reminderLabel(n)} ×
                      </Button>
                    ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Repeat2 className="size-4" />
            <ChoiceSelect
              label="重复规则"
              value={repeat}
              disabled={busy}
              className="flex-1"
              onChange={(value) =>
                value === "custom"
                  ? openCustomRepeat()
                  : setRepeat(value)
              }
              options={[...[
                "",
                "day:1",
                "week:1",
                "month:1",
                "year:1",
                "weekday",
                "weekend",
                "month-last",
                repeat,
                ...(task.repeatRule ? [task.repeatRule] : []),
              ]
                .filter((v, i, a) => a.indexOf(v) === i)
                .map(r => ({ value: r, label: r ? repeatRuleLabel(r) : "不重复" })),
                { value: "custom", label: "自定义重复…", separator: true },
              ]}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "确定"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void save(true)}
          >
            清除
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          清除日期会停止重复并取消未触发的自动提醒。
        </p>
        {timeOpen && (
          <Dialog open onOpenChange={setTimeOpen}>
            <DialogContent className="max-h-[90dvh] gap-3 overflow-y-auto p-3 sm:max-w-[260px]">
              <DialogTitle className="text-center text-sm">选择时间</DialogTitle>
              <div className="rounded-lg bg-muted/60 py-3 text-center text-2xl font-medium tabular-nums tracking-wider">
                {draftTime}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(["小时", "分钟"] as const).map((label, part) => (
                  <div key={label} className="min-w-0 space-y-1.5">
                    <p className="text-center text-xs text-muted-foreground">{label}</p>
                    <div
                      role="group"
                      aria-label={label}
                      ref={part === 0 ? hourColumn : minuteColumn}
                      className="grid max-h-48 grid-cols-3 gap-1 overflow-y-auto overscroll-contain rounded-lg border p-1"
                    >
                      {Array.from({ length: part === 0 ? 24 : 60 }, (_, n) => {
                        const value = String(n).padStart(2, "0");
                        const selected = draftTime.split(":")[part] === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-label={`${value}${part === 0 ? "时" : "分"}`}
                            aria-pressed={selected}
                            className={`h-8 rounded-md text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                            onClick={() => {
                              const parts = draftTime.split(":");
                              parts[part] = value;
                              setDraftTime(parts.join(":"));
                            }}
                          >{value}</button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => setTimeOpen(false)}>取消</Button>
                <Button size="sm" onClick={() => { setTime(draftTime); setTimeOpen(false); }}>应用时间</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {customRepeatOpen && (
          <CustomRepeatDialog rule={repeat} date={date} time={time} onClosed={() => setCustomRepeatOpen(false)} onApply={(value) => { setRepeat(value); setCustomRepeatOpen(false); }} />
        )}
      </DialogContent>
    </Dialog>
  );
}
