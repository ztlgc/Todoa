import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { ShortcutNotice } from "./ShortcutNotice";

export function QuickAddLauncher() {
  const showing = useRef(false);
  const [error, setError] = useState("");
  async function show() {
    if (showing.current) return;
    showing.current = true;
    setError("");
    try { await invoke("show_quick_add"); }
    catch { setError("无法打开快速添加窗口。请重试。"); }
    finally { showing.current = false; }
  }
  return <div className="flex flex-wrap items-center justify-end gap-3">
    <ShortcutNotice />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button id="show-quick-add" variant="outline" onClick={() => { void show(); }}>快速添加</Button>
  </div>;
}
