import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function ShortcutNotice() {
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    const accept = (value: string) => { if (!disposed) setStatus(value); };
    getCurrentWindow().listen<string>("global-shortcut-status", ({ payload }) => accept(payload)).then(async (unlisten) => {
      if (disposed) { unlisten(); return; }
      stop = unlisten;
      // Read after listening so the startup result cannot be lost.
      try { accept(await invoke<string>("global_shortcut_status")); }
      catch { accept("unavailable"); }
    }).catch(() => accept("unavailable"));
    return () => { disposed = true; stop?.(); };
  }, []);
  const ok = status === "registered";
  return <p id="shortcut-status" role={ok || status === "loading" ? "status" : "alert"}
    className={ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
    {status === "loading" ? "正在检查快捷键…" : ok ? "Ctrl+Shift+Space 快速添加" :
      status === "registration-failed" ? "Ctrl+Shift+Space 注册失败，可能已被其他应用占用。仍可点击快速添加。" :
      status === "show-failed" ? "快捷键已触发，但快速添加窗口未能显示或聚焦。请点击快速添加重试。" :
      "全局快捷键当前不可用。仍可点击快速添加。"}
  </p>;
}
