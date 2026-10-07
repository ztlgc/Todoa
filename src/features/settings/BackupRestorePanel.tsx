import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function RestoreNotice() {
  const [notice, setNotice] = useState<string>();
  useEffect(() => { if (isBrowserDebug()) return; let active = true; void invoke<string | null>("restore_status").then(value => { if (active && value) setNotice(value); }).catch(() => { if (active) setNotice("恢复日志无法读取。请保留数据库及恢复目录，不要手动删除文件。"); }); return () => { active = false; }; }, []);
  return notice ? <p role="status" className="mb-4 break-all rounded-md border p-3 text-sm">{notice}</p> : null;
}

export function BackupRestorePanel() {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string>();
  const writing = useRef(false);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) cancelButton.current?.focus(); }, [confirming]);
  async function run(restore: boolean) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setMessage(restore ? "正在校验和暂存备份…" : "正在生成一致性备份…");
    try {
      const result = await invoke<string>(restore ? "restore_database" : "backup_database", restore ? { confirmed: true } : {});
      setMessage(result === "cancelled" ? "已取消，数据未替换。" : result === "restarting" ? "已暂存。正在关闭连接并重启；若未自动重启，请重新打开应用。" : "备份已保存（未加密）。");
      setConfirming(false);
    } catch (error) { setMessage(`${restore ? "恢复" : "备份"}失败：${String(error)}`); }
    finally { writing.current = false; setBusy(false); }
  }
  return <section aria-labelledby="backup-heading" className="my-6 rounded-lg border p-4">
    <h2 id="backup-heading" className="font-semibold">备份与恢复</h2>
    <p className="my-2 text-sm text-muted-foreground">备份包含全部任务、清单、标签、提醒、日记与阶段总结和数据库设置，未经加密。窗口状态和系统开机启动状态不在备份中。</p>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || isBrowserDebug()} onClick={() => void run(false)}>备份数据</Button><Button ref={restoreButton} variant="outline" disabled={busy || isBrowserDebug()} onClick={() => { setMessage(undefined); setConfirming(true); }}>恢复备份</Button></div>
    {isBrowserDebug() && <p className="mt-2 text-sm text-muted-foreground">浏览器调试使用临时数据，备份与恢复需在桌面应用中操作。</p>}
    <Dialog open={confirming} onOpenChange={value => { if (!busy) setConfirming(value); }}>
      <DialogContent role="alertdialog" showCloseButton={false} initialFocus={cancelButton} finalFocus={restoreButton} className="max-h-[90dvh] overflow-y-auto">
      <DialogTitle id="restore-title">替换全部数据库内容？</DialogTitle>
      <DialogDescription id="restore-warning">恢复会替换现有任务、清单、标签、提醒、日记与阶段总结和数据库设置。应用会关闭并重新启动。请先备份当前数据；成功后也会保留恢复前快照。</DialogDescription>
      {message && <p role="status" className="break-all text-sm">{message}</p>}
      <div className="flex flex-wrap gap-2"><Button ref={cancelButton} variant="outline" disabled={busy} onClick={() => { setConfirming(false); restoreButton.current?.focus(); }}>取消恢复</Button><Button disabled={busy} onClick={() => void run(true)}>确认替换并选择备份</Button></div>
    </DialogContent></Dialog>
    {message && !confirming && <p role="status" className="mt-3 break-words text-sm">{message}</p>}
  </section>;
}
