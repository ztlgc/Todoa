import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function AutostartSettings() {
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const writing = useRef(false);
  const active = useRef(false);
  const generation = useRef(0);
  async function refresh() {
    const request = ++generation.current;
    try {
      const current = await invoke<boolean>("autostart_status");
      if (active.current && request === generation.current) setEnabled(current);
    } catch {
      if (active.current && request === generation.current) { setEnabled(undefined); setError("无法读取系统开机启动状态。请重试。"); }
    }
  }
  useEffect(() => {
    active.current = true;
    const focus = () => { if (!writing.current) void refresh(); };
    void refresh(); window.addEventListener("focus", focus);
    return () => { active.current = false; ++generation.current; window.removeEventListener("focus", focus); };
  }, []);
  async function change(next: boolean) {
    if (writing.current || enabled === undefined) return;
    writing.current = true; ++generation.current; setBusy(true); setError(undefined);
    try {
      const actual = await invoke<boolean>("set_autostart", { enabled: next });
      if (active.current) setEnabled(actual);
      await refresh();
    } catch {
      if (active.current) setError("更改开机启动失败，已重新读取系统状态。请重试。");
      await refresh();
    } finally { writing.current = false; if (active.current) setBusy(false); }
  }
  return <section aria-labelledby="autostart-heading" className="my-6 rounded-lg border p-4">
    <h2 id="autostart-heading" className="font-semibold">启动与窗口</h2>
    <div className="mt-3 flex items-center gap-3"><Checkbox id="autostart-toggle" aria-label="登录后在后台启动 Todoa" checked={enabled === true} disabled={busy || enabled === undefined} onCheckedChange={value => void change(value)} /><label htmlFor="autostart-toggle">登录后在后台启动 Todoa</label></div>
    <p role="status" className="mt-2 text-sm text-muted-foreground">{busy ? "正在读取系统设置…" : enabled === undefined ? "系统状态尚未确认" : `系统实际状态：${enabled ? "已启用" : "已关闭"}`}</p>
    <p className="mt-2 text-sm text-muted-foreground">默认关闭。后台启动时托盘不可用会显示主窗口；手动打开总能显示主窗口。主窗口尺寸、位置和最大化状态会自动保存。</p>
    <Button className="mt-3" variant="outline" disabled={busy} onClick={() => { setError(undefined); void refresh(); }}>刷新系统状态</Button>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </section>;
}
