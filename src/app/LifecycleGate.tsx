import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function LifecycleGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    let disposed = false;
    let quitting = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    async function readStatus() {
      try {
        const current = await invoke<string>("lifecycle_status");
        if (!disposed && !quitting) {
          setStatus(current);
          if (current === "starting") timer = setTimeout(() => void readStatus(), 150);
        }
      } catch { if (!disposed && !quitting) setStatus("tray-unavailable"); }
    }
    getCurrentWindow().listen("app-quitting", () => { quitting = true; if (!disposed) setStatus("quitting"); })
      .then(async (unlisten) => {
        if (disposed) { unlisten(); return; }
        stop = unlisten;
        await readStatus();
      }).catch(() => { if (!disposed) setStatus((previous) => previous === "quitting" ? previous : "tray-unavailable"); });
    return () => { disposed = true; if (timer) clearTimeout(timer); stop?.(); };
  }, []);
  if (status === "quitting") return <p role="status">正在退出，等待本地写入完成…</p>;
  if (status === "loading" || status === "starting") return <p role="status">正在启动窗口和后台服务…</p>;
  return <>
    {status === "tray-unavailable" && <p role="alert" className="mb-4 text-sm text-destructive">
      托盘不可用。关闭主窗口将退出应用，不会隐藏到托盘。
    </p>}
    {children}
  </>;
}
