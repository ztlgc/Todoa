import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Star } from "lucide-react";
import { z } from "zod";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { dateKey, journalItemSchema, parseDateKey, type JournalItem } from "@/domain/journal";
import { journalKey, useCreateJournalFollowUp } from "./queries";
import { newWorkItem, WorkItemFields } from "./WorkItemFields";
import { useJournalDraft } from "./useJournalDraft";

const quickSchema = z.object({ date: z.string().refine(value => { try { parseDateKey(value); return true; } catch { return false; } }), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), item: journalItemSchema.extend({ title: z.string().max(500) }), createTask: z.boolean() });
type QuickDraft = z.infer<typeof quickSchema>;
const decode = (value: unknown) => quickSchema.parse(value);
export function QuickWorkEntry({ target, clients, onDirty, onBusy, onSaved }: { target: { date: string; sequence: number }; clients: string[]; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void; onSaved: (date: string) => void }) {
  const now = new Date();
  const [form, setForm] = useState<QuickDraft>(() => ({ date: target.date, time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, item: newWorkItem(), createTask: true }));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [retry, setRetry] = useState<{ date: string; item: JournalItem } | null>(null);
  const client = useQueryClient(), followUp = useCreateJournalFollowUp();
  const input = useRef<HTMLInputElement>(null), writing = useRef(false), composing = useRef(false);
  const dirty = !!(form.item.title || form.item.notes || form.item.client || form.item.business || form.item.nextAction);
  const draft = useJournalDraft("quick", form, dirty, decode);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onBusy(busy || followUp.isPending); }, [busy, followUp.isPending, onBusy]);
  useEffect(() => {
    if (!target.sequence) return;
    setForm(current => ({ ...current, date: target.date }));
    input.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }); input.current?.focus();
  }, [target]);
  function change(patch: Partial<JournalItem>) { setForm(current => ({ ...current, item: { ...current.item, ...patch } })); setNotice(""); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (writing.current || composing.current) return;
    if (draft.recovery) { setNotice("请先恢复或舍弃已有草稿，再保存新记录。"); return; }
    if (!form.item.title.trim()) { setNotice("先写下这次沟通或业务推进的事项。"); input.current?.focus(); return; }
    writing.current = true; setBusy(true); setNotice("");
    try {
      const date = parseDateKey(form.date), occurredAt = new Date(`${date}T${form.time}:00`).toISOString();
      const item = journalItemSchema.parse({ ...form.item, title: form.item.title.trim(), client: form.item.client?.trim(), business: form.item.business?.trim(), nextAction: form.item.nextAction?.trim(), occurredAt });
      await journalRepository.append(date, item);
      await client.invalidateQueries({ queryKey: journalKey });
      draft.clear();
      const savedAt = new Date();
      setForm(current => ({ ...current, time: `${String(savedAt.getHours()).padStart(2, "0")}:${String(savedAt.getMinutes()).padStart(2, "0")}`, item: newWorkItem() }));
      setNotice("已保存到当天日记。"); onSaved(date);
      if (item.nextAction && form.createTask) {
        try { await followUp.mutateAsync({ date, item }); setNotice("记录已保存，跟进已加入待办。"); setRetry(null); }
        catch (cause) { setRetry({ date, item }); setNotice(`记录已保存，跟进创建失败：${cause instanceof Error ? cause.message : String(cause)}`); }
      }
    } catch (cause) { setNotice(`保存失败：${cause instanceof Error ? cause.message : String(cause)}。输入已保留。`); }
    finally { writing.current = false; setBusy(false); }
  }
  return <form className="jp-quick" aria-label="快捷工作记录" onSubmit={event => void submit(event)}>
    <header><div><span className="jp-section-label">随手记一件</span><p>记下客户沟通、业务进展和下一步安排</p></div><label className="jp-quick-date"><span>记录日期</span><input type="date" aria-label="快捷记录日期" min="1000-01-01" max="9999-12-31" required value={form.date} disabled={busy} onInput={event => { const date = event.currentTarget.value; setForm(current => ({ ...current, date })); }} onChange={event => setForm(current => ({ ...current, date: event.target.value }))} /></label></header>
    {draft.recovery && <div className="jp-draft-recovery" role="status"><span>有一份未提交的本地草稿</span><button type="button" onClick={() => { const recovered = draft.recover(); if (recovered) setForm(recovered); }}>恢复草稿</button><button type="button" onClick={draft.clear}>舍弃草稿</button></div>}
    <fieldset disabled={busy || followUp.isPending}>
      <input ref={input} className="jp-quick-title" aria-label="记录事项" placeholder="例如：与华兴制造确认续贷资料，尚缺应收账款明细" maxLength={500} value={form.item.title} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} onChange={event => change({ title: event.target.value })} />
      <WorkItemFields item={form.item} onChange={change} clients={clients} prefix="快捷记录" followUp={false} />
      <details className="jp-quick-details" open={!!(form.item.notes || form.item.nextAction)} onToggle={undefined}><summary>补充沟通内容与下一步</summary><label className="jp-field">沟通内容 / 阶段进展<textarea aria-label="快捷记录详情" placeholder="客户反馈了什么、今天推进到哪一步、还缺什么" maxLength={20000} value={form.item.notes} onChange={event => change({ notes: event.target.value })} /></label>
        <div className="jp-field-grid jp-followup-fields"><label className="jp-field">下一步跟进<input aria-label="快捷记录下一步" maxLength={500} placeholder="例如：催收三季度财报" value={form.item.nextAction ?? ""} onChange={event => change({ nextAction: event.target.value })} /></label><label className="jp-field">跟进时间<input type="datetime-local" aria-label="快捷记录跟进时间" value={form.item.followUpAt ? `${dateKey(new Date(form.item.followUpAt))}T${new Date(form.item.followUpAt).toTimeString().slice(0, 5)}` : ""} onInput={event => change({ followUpAt: event.currentTarget.value ? new Date(event.currentTarget.value).toISOString() : null })} onChange={event => change({ followUpAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label></div>
        <label className="jp-check"><input type="checkbox" checked={form.createTask} onChange={event => setForm(current => ({ ...current, createTask: event.target.checked }))} />填写下一步后，同时创建跟进待办</label>
      </details>
      <div className="jp-quick-bottom"><label className="jp-check"><input type="checkbox" checked={form.item.important} onChange={event => change({ important: event.target.checked })} /><Star size={14} />重点事项</label><label className="jp-quick-time">发生时间<input type="time" aria-label="快捷记录发生时间" value={form.time} required onInput={event => { const time = event.currentTarget.value; setForm(current => ({ ...current, time })); }} onChange={event => setForm(current => ({ ...current, time: event.target.value }))} /></label><button type="submit" className="jp-primary"><Plus size={16} />{busy ? "正在记录…" : "保存这条记录"}</button></div>
    </fieldset>
    <div className="jp-quick-feedback"><p role={notice.includes("失败") ? "alert" : "status"}>{notice || draft.feedback || "保存后自动归入当天日记"}</p>{retry && <button type="button" disabled={followUp.isPending} onClick={() => { void followUp.mutateAsync(retry).then(() => { setRetry(null); setNotice("跟进已加入待办。"); }).catch(cause => setNotice(`记录已保存，跟进创建失败：${cause instanceof Error ? cause.message : String(cause)}`)); }}><Check size={13} />重试创建跟进</button>}</div>
  </form>;
}
