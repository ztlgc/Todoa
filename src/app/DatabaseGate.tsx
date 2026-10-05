import { useEffect, useState, type ReactNode } from "react";
import { initDatabase } from "@/data/db/initDatabase";
import { isBrowserDebug } from "./browserDebug";

export function DatabaseGate({ children }: { children: ReactNode }) {
  const [view, setView] = useState<"loading" | "ready" | "error">(() => isBrowserDebug() ? "ready" : "loading");
  useEffect(() => {
    if (isBrowserDebug()) return;
    let active = true;
    initDatabase().then(
      () => active && setView("ready"),
      () => active && setView("error"),
    );
    return () => { active = false; };
  }, []);

  if (view === "loading") return <p role="status">正在检查本地数据库…</p>;
  if (view === "error") {
    return (
      <div role="alert" className="space-y-3">
        <p>本地数据库未能安全启动。未打开待办数据。</p>
        <p>请完全关闭应用，确认数据库问题已解决后再重新打开。</p>
      </div>
    );
  }
  return children;
}
