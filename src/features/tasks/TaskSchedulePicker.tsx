import { useState } from "react";
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Task, UpdateTaskInput } from "@/domain/task";
import { fromLocalInput, toLocalInput } from "@/domain/taskDates";
import { repeatRuleLabel } from "@/domain/naturalTaskInput";
import { TaskReminders } from "@/features/reminders/TaskReminders";

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
  const [time, setTime] = useState(initial.slice(11, 16));
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
  const [repeatInterval, setRepeatInterval] = useState("1");
  const [repeatUnit, setRepeatUnit] = useState("day");
  const [repeatError, setRepeatError] = useState<string>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [manual, setManual] = useState(false);
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
        repeatRule: clear ? null : repeat || null,
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
  function openCustomRepeat() {
    const match = /^(day|week|month|year):(\d+)$/.exec(repeat);
    setRepeatUnit(match?.[1] ?? "day");
    setRepeatInterval(match?.[2] ?? "1");
    setRepeatError(undefined);
    setCustomRepeatOpen(true);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClosed();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-[340px]"
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
              className="h-auto flex-col gap-1"
              disabled={busy}
              onClick={() => shortcut(n)}
            >
              <Icon className="size-5" />
              <span className="text-xs">{label}</span>
            </Button>
          ))}
        </div>
        <div className="-mt-2 flex items-center justify-between">
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
        <div className="grid grid-cols-7 gap-1 text-center text-sm">
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
              className={`mx-auto size-8 rounded-full hover:bg-accent ${date === key(d) ? "bg-primary text-primary-foreground hover:bg-primary" : key(d) === key(new Date()) ? "bg-secondary font-semibold" : d.getMonth() !== month.getMonth() ? "text-muted-foreground/50" : ""}`}
            >
              {d.getDate()}
            </button>
          ))}
        </div>
        <div className="space-y-3 border-t pt-3">
          <label className="flex items-center gap-2 text-sm">
            <Clock className="size-4" />
            <input
              className="h-8 min-w-0 flex-1 rounded-lg border px-2 text-sm"
              type="time"
              aria-label="截止时间"
              value={time}
              disabled={busy}
              onInput={(e) => setTime(e.currentTarget.value)}
            />
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
          </label>
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
                <select
                  aria-label="自定义提醒单位"
                  value={customUnit}
                  disabled={busy}
                  className="h-8 rounded-md border px-1 text-xs"
                  onChange={(e) => setCustomUnit(e.target.value)}
                >
                  <option value="hour">小时</option>
                  <option value="day">天</option>
                </select>
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
          <label className="flex items-center gap-2 text-sm">
            <Repeat2 className="size-4" />
            <select
              aria-label="重复规则"
              value={repeat}
              disabled={busy}
              className="min-w-0 flex-1 rounded-md border p-2"
              onChange={(e) =>
                e.target.value === "custom"
                  ? openCustomRepeat()
                  : setRepeat(e.target.value)
              }
            >
              {[
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
                .map((r) => (
                  <option key={r} value={r}>
                    {r ? repeatRuleLabel(r) : "不重复"}
                  </option>
                ))}
              <option value="custom">自定义重复…</option>
            </select>
          </label>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setManual(!manual)}>
          管理独立提醒
        </Button>
        {manual && <TaskReminders task={task} disabled={busy} />}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "确定"}
          </Button>
          <Button
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
        {customRepeatOpen && (
          <Dialog open onOpenChange={setCustomRepeatOpen}>
            <DialogContent className="sm:max-w-xs">
              <DialogTitle>自定义重复</DialogTitle>
              <div className="flex items-center gap-2">
                <span>每</span>
                <Input
                  aria-label="重复间隔"
                  type="number"
                  min="1"
                  max="999"
                  value={repeatInterval}
                  onChange={(e) => setRepeatInterval(e.target.value)}
                  className="min-w-0 flex-1"
                />
                <select
                  aria-label="重复单位"
                  value={repeatUnit}
                  className="rounded-md border p-2"
                  onChange={(e) => setRepeatUnit(e.target.value)}
                >
                  {[
                    ["day", "天"],
                    ["week", "周"],
                    ["month", "月"],
                    ["year", "年"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {repeatError && (
                <p role="alert" className="text-xs text-destructive">
                  {repeatError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCustomRepeatOpen(false)}
                >
                  取消
                </Button>
                <Button
                  onClick={() => {
                    const interval = Number(repeatInterval);
                    if (
                      !Number.isSafeInteger(interval) ||
                      interval < 1 ||
                      interval > 999
                    ) {
                      setRepeatError("请输入1到999之间的整数。");
                      return;
                    }
                    setRepeat(`${repeatUnit}:${interval}`);
                    setCustomRepeatOpen(false);
                  }}
                >
                  应用重复
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
