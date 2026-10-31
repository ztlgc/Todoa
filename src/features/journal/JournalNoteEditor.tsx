import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { journalImageStore } from "@/data/repositories/JournalContentRepository";
import { journalDocument, parseJournalDocument } from "@/domain/journalContent";
import { emptyJournal, parseJournalDraft, type JournalKind, type JournalRecord } from "@/domain/journal";
import { ContentEditor } from "@/features/tasks/TaskContentEditor";
import { journalKey } from "./queries";
import { holdJournalImages } from "@/data/journalImageMaintenance";
import { plainDocument } from "@/domain/contentDocument";

export type JournalFlush = () => Promise<boolean>;
type Draft = { doc: JSONContent; revision: number; legacyKey?: string };
export function JournalNoteEditor({ kind, start, record, onDirty, onBusy, onFlush, onReady, onCapture, title = "今日工作记录", label = "日记工作记录", template }: {
  kind: JournalKind; start: string; record?: JournalRecord;
  onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onFlush: (flush: JournalFlush | null) => void;
  onReady?: () => void;
  onCapture?: (text: string) => void;
  title?: string; label?: string; template?: string;
}) {
  const client = useQueryClient(), images = useMemo(() => journalImageStore(kind, start), [kind, start]);
  const key = `todoa.journal.content-draft.v1:${journalRepository.draftNamespace}:${kind}:${start}`;
  const [initial] = useState(() => journalDocument(record));
  const current = useRef(initial), baseline = useRef(JSON.stringify(initial)), revision = useRef(record?.contentRevision ?? 0);
  const editor = useRef<Editor | null>(null), composing = useRef(false), importing = useRef(false), mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), pending = useRef<Promise<boolean> | null>(null);
  const callbacks = useRef({ onDirty, onBusy, onFlush, onReady }); callbacks.current = { onDirty, onBusy, onFlush, onReady };
  const [imagesReady, setImagesReady] = useState(false);
  const [selection, setSelection] = useState("");
  useEffect(() => {
    const selected = () => {
      const value = editor.current;
      if (!value || value.isDestroyed || !value.state?.selection) { setSelection(""); return; }
      const { from, to } = value.state.selection;
      setSelection(from === to ? "" : value.state.doc.textBetween(from, to, "\n").trim());
    };
    document.addEventListener("selectionchange", selected);
    return () => document.removeEventListener("selectionchange", selected);
  }, []);
  const [status, setStatus] = useState(record ? "已保存" : "自动保存"), [error, setError] = useState(""), [tools, setTools] = useState(false);
  const [recovery, setRecovery] = useState<Draft | null>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) { const value = JSON.parse(raw); const doc = parseJournalDocument(value.doc).doc; if (JSON.stringify(doc) !== baseline.current) return { doc, revision: value.revision }; }
      const legacyKey = `todoa.journal.draft.v2:${journalRepository.draftNamespace}:editor:${kind}:${start}`;
      const legacy = localStorage.getItem(legacyKey);
      if (legacy) return { doc: journalDocument({ ...parseJournalDraft(JSON.parse(legacy)), revision: 0, createdAt: "", updatedAt: "", deletedAt: null }), revision: revision.current, legacyKey };
      const quickKey = `todoa.journal.draft.v2:${journalRepository.draftNamespace}:quick`, quickRaw = localStorage.getItem(quickKey);
      if (kind === "day" && quickRaw) {
        const quick = JSON.parse(quickRaw);
        if (quick.date === start) {
          const parsed = parseJournalDraft({ ...emptyJournal("day", start), items: [quick.item] });
          const extra = journalDocument({ ...parsed, revision: 0, createdAt: "", updatedAt: "", deletedAt: null });
          return { doc: { type: "doc", content: [...(initial.content ?? []), ...(extra.content ?? [])] }, revision: revision.current, legacyKey: quickKey };
        }
      }
    } catch { /* Leave unreadable stored drafts intact. */ }
    return null;
  });
  const recovering = useRef(!!recovery);
  const legacyDraft = useRef<string | undefined>(recovery?.legacyKey);
  function clearLegacyDraft() {
    if (!legacyDraft.current) return;
    try { localStorage.removeItem(legacyDraft.current); legacyDraft.current = undefined; }
    catch { /* Retain the source key until a later successful handoff. */ }
  }
  function persist(): boolean {
    if (JSON.stringify(current.current) === baseline.current) { if (!recovering.current) clearLegacyDraft(); return true; }
    try { localStorage.setItem(key, JSON.stringify({ doc: current.current, revision: revision.current })); clearLegacyDraft(); return true; }
    catch { if (mounted.current) setError("本地草稿保存失败，请保持页面打开并重试保存。"); return false; }
  }
  function schedule() {
    clearTimeout(timer.current);
    if (!recovering.current && !importing.current && !composing.current && JSON.stringify(current.current) !== baseline.current)
      timer.current = setTimeout(() => { void latestFlush.current(); }, 650);
  }
  function changed(doc: JSONContent) {
    current.current = doc;
    const dirty = JSON.stringify(doc) !== baseline.current;
    callbacks.current.onDirty(dirty);
    if (!dirty && !pending.current) {
      try { localStorage.removeItem(key); } catch { setError("本地旧草稿未能清理，请重试。"); }
      setStatus(record ? "已保存" : "自动保存");
    }
    persist(); schedule();
    if (dirty) setStatus("待保存");
  }
  async function flush(): Promise<boolean> {
    clearTimeout(timer.current);
    if (!imagesReady || recovering.current || importing.current || composing.current) return false;
    if (pending.current) { if (!await pending.current) return false; return flush(); }
    if (JSON.stringify(current.current) === baseline.current) { callbacks.current.onDirty(false); return true; }
    const doc = current.current, submitted = JSON.stringify(doc);
    if (mounted.current) { setStatus("保存中…"); setError(""); }
    const writing = (async () => {
      try {
        revision.current = await journalRepository.saveContent(kind, start, doc, revision.current);
        clearLegacyDraft();
        baseline.current = submitted;
        if (JSON.stringify(current.current) === submitted) {
          try { localStorage.removeItem(key); } catch { /* The saved document can safely recover on restart. */ }
          callbacks.current.onDirty(false);
          if (mounted.current) setStatus("已保存");
        } else persist();
        void client.invalidateQueries({ queryKey: journalKey });
        return true;
      } catch (cause) {
        persist();
        if (mounted.current) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus("未保存"); }
        return false;
      }
    })();
    pending.current = writing;
    const saved = await writing;
    pending.current = null;
    if (saved && mounted.current && JSON.stringify(current.current) !== baseline.current) return flush();
    if (saved && mounted.current) callbacks.current.onReady?.();
    return saved;
  }
  const latestFlush = useRef(flush); latestFlush.current = flush;
  useEffect(() => { setImagesReady(false); return holdJournalImages(journalRepository.draftNamespace, () => { setImagesReady(true); callbacks.current.onReady?.(); }, async () => { if (pending.current) await pending.current; }); }, []);
  useEffect(() => {
    mounted.current = true;
    callbacks.current.onFlush(() => latestFlush.current());
    const retain = () => persist();
    window.addEventListener("pagehide", retain);
    return () => { mounted.current = false; clearTimeout(timer.current); retain(); window.removeEventListener("pagehide", retain); callbacks.current.onFlush(null); };
  }, [key]);
  // Task archival changes only the task section. Another window's note updates
  // can replace this editor only while it is clean.
  useEffect(() => {
    const next = record?.contentRevision ?? 0;
    if (next > revision.current && !pending.current && JSON.stringify(current.current) === baseline.current && !recovering.current) {
      const doc = journalDocument(record);
      current.current = doc; baseline.current = JSON.stringify(doc); revision.current = next;
      editor.current?.commands.setContent(doc, { emitUpdate: false });
    }
  }, [record]);
  return <section className="daily-note" aria-labelledby="journal-note-heading">
    <div className="daily-section-heading"><h2 id="journal-note-heading">{title}</h2><div className="daily-note-actions"><span role="status">{status}</span>{onCapture && <Button variant="ghost" size="sm" disabled={!selection || !!recovery} onMouseDown={event => event.preventDefault()} onClick={() => onCapture(selection)}>收录选中内容</Button>}<Button variant="ghost" size="sm" aria-label="设置内容格式" disabled={!!recovery} aria-pressed={tools} onClick={() => { editor.current?.commands.focus(); setTools(value => !value); }}>Aa</Button></div></div>
    <div className="review-writing-hint"><p>{kind === "day" ? "今天推进了什么？有什么结果，或者有什么值得以后记住的事？" : "从右侧选择素材加入回顾，也可以直接开始写。正文会独立保存。"}</p>{template && <Button variant="ghost" size="sm" disabled={!!recovery || !imagesReady} onClick={() => {
      const doc = { type: "doc", content: [...(current.current.content ?? []), ...(plainDocument(template).content ?? [])] };
      editor.current?.commands.setContent(doc, { emitUpdate: false }); changed(doc);
    }}>插入回顾提纲</Button>}</div>
    {recovery && imagesReady && <div className="daily-recovery" role="status"><p>有一份未保存的补充内容</p><Button size="sm" onClick={() => {
      recovering.current = false;
      const doc = recovery.doc;
      editor.current?.commands.setContent(doc, { emitUpdate: false });
      setRecovery(null); changed(doc);
    }}>恢复草稿</Button><Button variant="ghost" size="sm" onClick={() => {
      try { localStorage.removeItem(key); if (recovery.legacyKey) localStorage.removeItem(recovery.legacyKey); legacyDraft.current = undefined; recovering.current = false; setRecovery(null); callbacks.current.onReady?.(); }
      catch { setError("本地草稿未能清理，请重试。"); }
    }}>舍弃草稿</Button></div>}
    {imagesReady ? <ContentEditor initial={current.current} imageStore={images} label={label} editable={!recovery} showTools={tools} onToolsClosed={() => setTools(false)} onChange={changed}
      onEditor={value => { editor.current = value; if (JSON.stringify(value.getJSON()) !== JSON.stringify(current.current)) value.commands.setContent(current.current, { emitUpdate: false }); }} onComposition={value => { composing.current = value; if (!value) { changed(editor.current?.getJSON() ?? current.current); callbacks.current.onReady?.(); } }}
      onBusy={value => { importing.current = value; callbacks.current.onBusy(value); if (!value) { schedule(); callbacks.current.onReady?.(); } }} /> : <p role="status">正在读取编辑内容…</p>}
    {error && <div role="alert" className="daily-error"><p>{error}</p><Button size="sm" variant="outline" onClick={() => { void flush(); }}>重试保存</Button><Button size="sm" variant="ghost" onClick={() => {
      void journalRepository.get(kind, start).then(saved => {
        if (!persist()) return;
        setRecovery({ doc: current.current, revision: revision.current }); recovering.current = true;
        const doc = journalDocument(saved); current.current = doc; baseline.current = JSON.stringify(doc); revision.current = saved?.contentRevision ?? 0;
        editor.current?.commands.setContent(doc, { emitUpdate: false }); callbacks.current.onDirty(false); setError(""); setStatus("已读取已保存内容");
      }).catch(cause => setError(String(cause)));
    }}>读取已保存内容</Button></div>}
  </section>;
}
