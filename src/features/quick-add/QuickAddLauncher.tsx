import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateTask } from "@/features/tasks/queries";
import { ShortcutNotice } from "./ShortcutNotice";

export function QuickAddLauncher() {
  const showing = useRef(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const create = useCreateTask();
  async function show() {
    if (isBrowserDebug()) { setOpen(true); return; }
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
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogTitle>快速添加任务</DialogTitle>
      <DialogDescription>任务将加入当前浏览器调试会话。</DialogDescription>
      <form className="flex gap-2" onSubmit={async event => { event.preventDefault(); if (!title.trim()) return; try { await create.mutateAsync({ title }); setTitle(""); setOpen(false); setError(""); } catch { setError("添加任务失败，请检查输入后重试。"); } }}>
        <Input aria-label="任务名称" value={title} onChange={event => setTitle(event.target.value)} autoFocus />
        <Button type="submit" disabled={create.isPending}>添加</Button>
      </form>
    </DialogContent></Dialog>
  </div>;
}
