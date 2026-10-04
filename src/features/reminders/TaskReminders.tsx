import { useRef,useState,type FormEvent } from "react";
import type { Task } from "@/domain/task";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { futureTime } from "@/data/repositories/ReminderRepository";
import { useReminders,useWriteReminder,useSchedulerStatus } from "./queries";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { fromLocalInput } from "@/domain/taskDates";
function localTime(value:string) {
  const d=new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
export function TaskReminders({task,disabled,onDraftChange,onBusyChange}:{task:Task;disabled:boolean;onDraftChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void}) {
  const [open,setOpen]=useState(false);
  const draft=useRef(false);
  const {confirm,confirmation}=useConfirmDialog();
  return <div className="pl-7">{confirmation}<Button size="sm" variant="ghost" disabled={disabled} onClick={async()=>{if(open&&draft.current&&!(await confirm("放弃未保存的提醒输入？")))return;setOpen(!open);draft.current=false;onDraftChange?.(false);}} aria-expanded={open}>提醒</Button>{open&&<ReminderPanel task={task} disabled={disabled} onDraftChange={value=>{draft.current=value;onDraftChange?.(value);}} onBusyChange={onBusyChange}/>}</div>;
}
function NotificationNotice() {
  const status=useSchedulerStatus();
  const unavailable=status.isError||status.data!=="ready";
  return <div className="space-y-1 text-xs text-muted-foreground">
    {status.isPending?<p role="status">正在检查系统通知…</p>:unavailable?<p role="alert" className="text-destructive">{status.data==="notification-setting-unknown"?"系统通知设置暂无法确认，将尝试投递；成功只代表 API 接受，不代表你已看到通知。":status.data==="NOTIFICATION_DENIED"?"系统通知已关闭，请在 Windows 设置中允许通知。":status.data==="REMINDER_MARK_FAILED"?"通知 API 已接受，但触发状态保存失败；正在重试保存。":status.data==="stopped"?"提醒调度已停止。":"通知暂不可用或发送失败，未成功的提醒保持待触发并自动重试。"}</p>:<p>已接入系统通知。API 接受不代表你已看到通知；通知关闭或勿扰可能抑制显示。</p>}
    <p>过期提醒按时间补发，可能出现多条。应用退出后不发送提醒。</p>
  </div>;
}
function ReminderPanel({task,disabled,onDraftChange,onBusyChange}:{task:Task;disabled:boolean;onDraftChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void}) {
  const query=useReminders(task.id),write=useWriteReminder(task.id);
  const [draft,setDraft]=useState(""),[editing,setEditing]=useState<number>(),[error,setError]=useState<string>();
  const busy=useRef(false);
  const {confirm,confirmation}=useConfirmDialog();
  const draftZone=useRef(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const composing=useRef(false);
  const blocked=disabled||write.isPending;
  async function save(event:FormEvent) {
    event.preventDefault(); if(busy.current||blocked||composing.current||task.status!=="todo")return;
    if(draftZone.current!==Intl.DateTimeFormat().resolvedOptions().timeZone){setError("系统时区已改变，请核对后重新输入提醒时刻。");return;}
    let time:string;
    try { const utc=fromLocalInput(draft); if(!utc)throw new Error(); time=futureTime(utc); } catch {setError("请选择有效的未来时刻。");return;}
    busy.current=true;onBusyChange?.(true);setError(undefined);
    try {await write.mutateAsync({action:editing===undefined?"create":"edit",id:editing,time});setDraft("");setEditing(undefined);onDraftChange?.(false);} catch {setError("提醒保存失败，输入已保留，请重试。");} finally {busy.current=false;onBusyChange?.(false);}
  }
  async function remove(id:number) {
    if(busy.current||blocked)return;busy.current=true;onBusyChange?.(true);setError(undefined);
    try {await write.mutateAsync({action:"delete",id});if(editing===id){setEditing(undefined);setDraft("");onDraftChange?.(false);}} catch {setError("删除提醒失败，请重试。");}finally{busy.current=false;onBusyChange?.(false);}
  }
  return <section aria-label={`任务提醒：${task.title}`} className="space-y-3 rounded-lg border p-3">
    {confirmation}<NotificationNotice/>
    {query.isPending&&<p role="status">正在读取提醒…</p>}
    {query.isError&&<p role="alert">提醒读取失败。<Button onClick={()=>void query.refetch()}>重试</Button></p>}
    {query.data?.map(r=><div key={r.id} data-reminder-id={r.id} className="flex flex-wrap items-center gap-2 text-sm"><time dateTime={r.remindAt}>{new Date(r.remindAt).toLocaleString()}</time><span>{r.triggeredAt?"API 已接受":"待触发"}</span>{!r.triggeredAt&&task.status==="todo"&&<Button size="sm" variant="outline" disabled={blocked} onClick={async()=>{if(draft&&!(await confirm("放弃当前提醒输入并编辑这条提醒？")))return;draftZone.current=Intl.DateTimeFormat().resolvedOptions().timeZone;setEditing(r.id);setDraft(localTime(r.remindAt));onDraftChange?.(true);setError(undefined);}}>编辑提醒</Button>}<Button size="sm" variant="ghost" disabled={blocked} onClick={()=>void remove(r.id)}>删除提醒</Button></div>)}
    {task.status==="todo"?<form onSubmit={event=>void save(event)} className="flex flex-wrap gap-2"><label className="text-sm" htmlFor={`remind-${task.id}`}>{editing===undefined?"新增提醒":"编辑提醒"}</label><Input id={`remind-${task.id}`} type="datetime-local" value={draft} onChange={e=>{draftZone.current=Intl.DateTimeFormat().resolvedOptions().timeZone;setDraft(e.target.value);onDraftChange?.(!!e.target.value);}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{if(event.key==="Enter"&&(composing.current||event.nativeEvent.isComposing||event.keyCode===229))event.preventDefault();}} disabled={blocked||!query.isSuccess} className="min-w-0 max-w-full sm:w-auto"/><Button type="submit" disabled={blocked||!query.isSuccess}>{write.isPending?"正在保存…":"保存提醒"}</Button>{draft&&<Button type="button" variant="ghost" disabled={blocked} onClick={()=>{setEditing(undefined);setDraft("");onDraftChange?.(false);}}>清空提醒输入</Button>}</form>:<p className="text-xs">已完成任务不能新增提醒；取消完成不会恢复已取消提醒。</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
