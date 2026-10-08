import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bell, Send } from "lucide-react";
import { isBrowserDebug } from "@/app/browserDebug";
import { Button } from "@/components/ui/button";
import { PreferencesFeedback, SettingsSwitch } from "./FeatureSettings";
import { useAppPreferences, type AppPreferences } from "./preferences";

export function NotificationSettings() {
  const { query, save } = useAppPreferences();
  const [testStatus, setTestStatus] = useState<string>();
  const [testing, setTesting] = useState(false);
  const testingRef = useRef(false);
  function change(patch: Partial<AppPreferences>) { if (query.data) save.mutate({ ...query.data, ...patch }); }
  async function test() {
    if (testingRef.current || isBrowserDebug()) return;
    testingRef.current = true; setTesting(true); setTestStatus(undefined);
    try { await invoke("test_system_notification"); setTestStatus("已向系统提交测试通知，请确认是否看到通知。未显示时，请检查系统通知权限和勿扰模式。"); }
    catch (cause) { setTestStatus(String(cause).includes("NOTIFICATION_DENIED") ? "系统通知权限已关闭，请在系统设置中允许 Todoa 发送通知后重试。" : "测试通知发送失败，请检查系统通知设置后重试。"); }
    finally { testingRef.current = false; setTesting(false); }
  }
  const disabled = !query.isSuccess || save.isPending;
  return <div className="my-6 space-y-4">
    <PreferencesFeedback />
    <section className="space-y-5 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 font-semibold"><Bell aria-hidden="true" className="size-4" />系统通知</h2><p className="mt-2 text-sm text-muted-foreground">任务提醒到期后，通过系统通知提醒你。</p></div><SettingsSwitch label="系统通知" checked={query.data?.notificationsEnabled ?? true} disabled={disabled} onChange={value => change({ notificationsEnabled: value })} /></div>
      <div className="flex items-start justify-between gap-4 border-t pt-4"><div><h3 className="text-sm font-medium">在通知中显示任务标题</h3><p className="mt-1 text-sm text-muted-foreground">关闭后使用通用提示，保护任务内容。</p></div><SettingsSwitch label="在通知中显示任务标题" checked={query.data?.showTaskTitle ?? true} disabled={disabled} onChange={value => change({ showTaskTitle: value })} /></div>
      <p className="text-sm text-muted-foreground">通知声音和横幅样式由系统设置控制。应用需要保持运行，退出后无法发送任务提醒。</p>
    </section>
    <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="font-semibold">测试通知</h2><p className="text-sm text-muted-foreground">主动发送一条测试通知，不受上方通知开关限制。</p><Button variant="outline" disabled={testing || isBrowserDebug()} onClick={() => void test()}><Send aria-hidden="true" className="size-4" />{testing ? "正在发送…" : "发送系统测试通知"}</Button>{isBrowserDebug() && <p className="text-sm text-muted-foreground">请在 Todoa 桌面应用中测试系统通知，浏览器预览不发送通知。</p>}{testStatus && <p role="status" className="text-sm">{testStatus}</p>}</section>
    {save.isError && <p role="alert" className="text-sm text-destructive">保存失败，设置未更改。请重试。</p>}
  </div>;
}
