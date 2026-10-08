import { CalendarDays, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppPreferences } from "./preferences";

export function SettingsSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}><span className={`size-5 rounded-full bg-background shadow-sm transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} /></button>;
}
export function PreferencesFeedback() {
  const { query } = useAppPreferences();
  return query.isError ? <p role="alert" className="my-4 text-sm text-destructive">设置读取失败。<Button variant="outline" size="sm" onClick={() => void query.refetch()}>重新读取设置</Button></p> : query.isPending ? <p role="status" className="my-4 text-sm text-muted-foreground">正在读取设置…</p> : null;
}
export function FeatureSettings() {
  const { query, save } = useAppPreferences();
  return <div className="my-6 space-y-4">
    <p className="text-sm text-muted-foreground">选择左侧显示的功能。关闭后只隐藏入口，已有任务和日记会保留。</p>
    <PreferencesFeedback />
    <div className="grid gap-4 lg:grid-cols-2">{([{ field: "calendarEnabled", label: "日历", icon: CalendarDays, description: "按日期查看任务，安排接下来的计划。" }, { field: "journalEnabled", label: "日记", icon: BookOpen, description: "记录每天的想法，回顾生活中的点滴。" }] as const).map(item => <section key={item.field} className="rounded-xl border bg-card p-5">
      <div className="mb-5 flex items-center justify-between gap-4"><item.icon aria-hidden="true" className="size-6 text-muted-foreground" /><SettingsSwitch label={`显示${item.label}`} checked={query.data?.[item.field] ?? true} disabled={!query.isSuccess || save.isPending} onChange={value => { if (query.data) save.mutate({ ...query.data, [item.field]: value }); }} /></div>
      <h2 className="font-semibold">{item.label}</h2><p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
    </section>)}</div>
    {save.isError && <p role="alert" className="text-sm text-destructive">保存失败，设置未更改。请重试。</p>}
  </div>;
}
