import { useEffect, useState } from "react";
import { initDatabase } from "@/data/db/initDatabase";

type BootView = "loading" | "ready" | "error";

function App() {
  const [view, setView] = useState<BootView>("loading");

  useEffect(() => {
    let active = true;
    initDatabase().then(
      () => active && setView("ready"),
      () => active && setView("error"),
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Todoa · 数据库启动验证</h1>
        {view === "loading" && <p role="status">正在检查本地数据库…</p>}
        {view === "ready" && (
          <div role="status" className="space-y-2">
            <p>本地数据库已就绪，Schema 版本 1。</p>
            <p className="text-sm text-muted-foreground">当前页面只验证启动；待办功能尚未实现。</p>
          </div>
        )}
        {view === "error" && (
          <div role="alert" className="space-y-3">
            <p>本地数据库未能安全启动。未打开待办数据。</p>
            <p>请完全关闭应用，确认数据库问题已解决后再重新打开。</p>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
