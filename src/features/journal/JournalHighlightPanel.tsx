import { useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import type { HighlightInput, JournalHighlight } from "@/domain/journalReview";

export type JournalHighlightDraft = { input: HighlightInput; revision: number };
export interface JournalHighlightPanelProps {
  date: string;
  contentRevision: number;
  highlights: JournalHighlight[];
  draft: JournalHighlightDraft | null;
  onDraftChange: (draft: JournalHighlightDraft | null) => void;
  onSave: (input: HighlightInput, revision: number) => Promise<void>;
  onRemove: (item: JournalHighlight) => Promise<void>;
  onOpen: (date: string) => void;
  onBusy: (busy: boolean) => void;
}

const sourceLabels = { note: "工作记录", task: "已完成任务", legacy: "历史事项" };
function statusText(item: JournalHighlight) {
  return [item.sourceDeleted && "原文在回收站", item.sourceRevoked && "任务完成已撤销", item.sourceChanged && "原文已更新"].filter(Boolean).join(" · ");
}

export function JournalHighlightPanel(props: JournalHighlightPanelProps) {
  const { date, contentRevision, highlights, draft, onDraftChange, onOpen } = props;
  const [busy, setBusy] = useState(false), [composing, setComposing] = useState(false), [error, setError] = useState("");
  const working = useRef(false), composition = useRef(false), latest = useRef(props);
  latest.current = props;
  const id = useId(), { confirm, confirmation } = useConfirmDialog();
  useEffect(() => () => latest.current.onBusy(false), []);
  const entries = highlights.filter(item => item.date === date && !item.deletedAt);

  function begin() {
    setError("");
    onDraftChange({ input: { id: crypto.randomUUID(), date, summary: "", result: "", theme: "", sourceType: "note", sourceId: crypto.randomUUID(), sourceRevision: contentRevision }, revision: 0 });
  }
  function edit(item: JournalHighlight) {
    setError("");
    onDraftChange({ input: { id: item.id, date: item.date, summary: item.summary, result: item.result, theme: item.theme, sourceType: item.sourceType, sourceId: item.sourceId, sourceRevision: item.sourceType === "task" ? 0 : contentRevision }, revision: item.revision });
  }
  function change(field: "summary" | "result" | "theme", value: string) {
    if (draft) { setError(""); onDraftChange({ ...draft, input: { ...draft.input, [field]: value } }); }
  }
  async function run(action: () => Promise<void>) {
    if (working.current || composition.current) return;
    working.current = true; setBusy(true); latest.current.onBusy(true); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { working.current = false; setBusy(false); latest.current.onBusy(composition.current); }
  }
  async function save() {
    if (!draft) return;
    if (!draft.input.summary.trim()) { setError("请填写重点摘要。"); return; }
    const savedDraft = draft;
    await run(async () => {
      await latest.current.onSave({ ...savedDraft.input, summary: savedDraft.input.summary.trim(), result: savedDraft.input.result.trim(), theme: savedDraft.input.theme.trim() }, savedDraft.revision);
      if (latest.current.draft === savedDraft) latest.current.onDraftChange(null);
    });
  }
  async function cancel() {
    if (!draft || busy) return;
    if ((draft.input.summary || draft.input.result || draft.input.theme) && !await confirm("放弃尚未保存的重点编辑？", "放弃编辑")) return;
    setError(""); latest.current.onDraftChange(null);
  }
  async function remove(item: JournalHighlight) {
    if (working.current || !await confirm("删除这条重点？原始日记和已加入回顾的文字会保留。", "删除重点")) return;
    await run(() => latest.current.onRemove(item));
  }

  if (!draft && !entries.length) return <div className="review-highlight-add">{confirmation}<Button type="button" size="sm" variant="ghost" onClick={begin}><Plus size={14} aria-hidden="true" />添加重点</Button>{error && <p role="alert" className="daily-error">{error}</p>}</div>;
  return <section className="review-highlight-panel" aria-labelledby={`${id}-heading`} aria-busy={busy}>
    {confirmation}
    <div className="daily-section-heading"><h3 id={`${id}-heading`}>本日重点</h3><Button type="button" size="sm" variant="ghost" disabled={busy || !!draft} onClick={begin}><Plus size={14} aria-hidden="true" />添加重点</Button></div>
    {!!entries.length && <ul className="review-highlight-list">{entries.map(item => <li key={item.id} className="review-highlight-item">
      <div className="review-item-heading"><strong>{item.summary}</strong>{item.theme && <span className="review-theme">{item.theme}</span>}</div>
      {item.result && <p className="review-item-result">{item.result}</p>}
      <p className="review-source">{sourceLabels[item.sourceType]}{statusText(item) && ` · ${statusText(item)}`}</p>
      <div className="review-item-actions"><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onOpen(item.date)}>查看原文</Button><Button type="button" size="sm" variant="ghost" aria-label={`编辑重点：${item.summary}`} disabled={busy || !!draft} onClick={() => edit(item)}>编辑</Button><Button type="button" size="sm" variant="ghost" aria-label={`删除重点：${item.summary}`} disabled={busy || !!draft} onClick={() => void remove(item)}>删除</Button></div>
    </li>)}</ul>}
    {draft && <div className="review-highlight-editor" role="group" aria-label={draft.revision ? "编辑重点" : "收录重点"}>
      <p className="daily-search-scope" id={`${id}-help`}>重点是用于回顾的摘录，保存后不会随原文自动改写。</p>
      <label className="review-field" htmlFor={`${id}-summary`}>重点摘要（必填）<Input id={`${id}-summary`} value={draft.input.summary} required disabled={busy} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} aria-invalid={!!error && !draft.input.summary.trim()} onChange={event => change("summary", event.target.value)} onCompositionStart={() => { composition.current = true; setComposing(true); latest.current.onBusy(true); }} onCompositionEnd={() => { composition.current = false; setComposing(false); latest.current.onBusy(working.current); }} /></label>
      <label className="review-field" htmlFor={`${id}-result`}>结果说明（可选）<Input id={`${id}-result`} value={draft.input.result} disabled={busy} onChange={event => change("result", event.target.value)} onCompositionStart={() => { composition.current = true; setComposing(true); latest.current.onBusy(true); }} onCompositionEnd={() => { composition.current = false; setComposing(false); latest.current.onBusy(working.current); }} /></label>
      <label className="review-field" htmlFor={`${id}-theme`}>工作主题（可选）<Input id={`${id}-theme`} value={draft.input.theme} disabled={busy} onChange={event => change("theme", event.target.value)} onCompositionStart={() => { composition.current = true; setComposing(true); latest.current.onBusy(true); }} onCompositionEnd={() => { composition.current = false; setComposing(false); latest.current.onBusy(working.current); }} /></label>
      <div className="review-item-actions"><Button type="button" size="sm" disabled={busy || composing} onClick={() => void save()}>{busy ? "正在保存…" : "保存重点"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy || composing} onClick={() => void cancel()}>取消</Button></div>
    </div>}
    {error && <p id={`${id}-error`} role="alert" className="daily-error">{error}</p>}
  </section>;
}
