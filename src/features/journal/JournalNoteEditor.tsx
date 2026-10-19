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

export type JournalFlush = () => Promise<boolean>;
type Draft = { doc: JSONContent; revision: number; legacyKey?: string };
export function JournalNoteEditor({ kind, start, record, onDirty, onBusy, onFlush }: {
  kind: JournalKind; start: string; record?: JournalRecord;
  onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onFlush: (flush: JournalFlush | null) => void;
}) {
  const client = useQueryClient(), images = useMemo(() => journalImageStore(kind, start), [kind, start]);
  const key = `todoa.journal.content-draft.v1:${journalRepository.draftNamespace}:${kind}:${start}`;
  const [initial] = useState(() => journalDocument(record));
  const current = useRef(initial), baseline = useRef(JSON.stringify(initial)), revision = useRef(record?.contentRevision ?? 0);
  const editor = useRef<Editor | null>(null), composing = useRef(false), importing = useRef(false), mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), pending = useRef<Promise<boolean> | null>(null);
  const callbacks = useRef({ onDirty, onBusy, onFlush }); callbacks.current = { onDirty, onBusy, onFlush };
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
  function persist() {
    if (JSON.stringify(current.current) === baseline.current) return;
    try { localStorage.setItem(key, JSON.stringify({ doc: current.current, revision: revision.current })); }
    catch { if (mounted.current) setError("本地草稿保存失败，请保持页面打开并重试保存。"); }
  }
  function changed(doc: JSONContent) {
    current.current = doc;
    const dirty = JSON.stringify(doc) !== baseline.current;
    callbacks.current.onDirty(dirty);
    if (!dirty && !pending.current) {
      try { localStorage.removeItem(key); } catch { setError("本地旧草稿未能清理，请重试。"); }
      setStatus(record ? "已保存" : "自动保存");
    }
    persist(); clearTimeout(timer.current);
    if (dirty) { setStatus("待保存"); if (!composing.current) timer.current = setTimeout(() => { void flush(); }, 650); }
  }
  async function flush(): Promise<boolean> {
    clearTimeout(timer.current);
    if (recovering.current || importing.current || composing.current) return false;
    if (pending.current) { if (!await pending.current) return false; return flush(); }
    if (JSON.stringify(current.current) === baseline.current) { callbacks.current.onDirty(false); return true; }
    const doc = current.current, submitted = JSON.stringify(doc);
    if (mounted.current) { setStatus("保存中…"); setError(""); }
    const writing = (async () => {
      try {
        revision.current = await journalRepository.saveContent(kind, start, doc, revision.current);
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
    if (saved && JSON.stringify(current.current) !== baseline.current) return flush();
    return saved;
  }
  const latestFlush = useRef(flush); latestFlush.current = flush;
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
    <div className="daily-section-heading"><h2 id="journal-note-heading">工作补充</h2><div className="daily-note-actions"><span role="status">{status}</span><Button variant="ghost" size="sm" aria-label="设置补充内容格式" disabled={!!recovery} aria-pressed={tools} onClick={() => { editor.current?.commands.focus(); setTools(value => !value); }}>Aa</Button></div></div>
    {recovery && <div className="daily-recovery" role="status"><p>有一份未保存的补充内容</p><Button size="sm" onClick={() => {
      recovering.current = false;
      const doc = recovery.doc;
      editor.current?.commands.setContent(doc, { emitUpdate: false });
      setRecovery(null); changed(doc);
      if (recovery.legacyKey) { try { localStorage.removeItem(recovery.legacyKey); } catch { /* Keep original draft if storage fails. */ } }
    }}>恢复草稿</Button><Button variant="ghost" size="sm" onClick={() => { localStorage.removeItem(key); if (recovery.legacyKey) localStorage.removeItem(recovery.legacyKey); recovering.current = false; setRecovery(null); }}>舍弃草稿</Button></div>}
    <ContentEditor initial={initial} imageStore={images} label="日记补充内容" editable={!recovery} showTools={tools} onToolsClosed={() => setTools(false)} onChange={changed}
      onEditor={value => { editor.current = value; }} onComposition={value => { composing.current = value; if (!value) changed(editor.current?.getJSON() ?? current.current); }}
      onBusy={value => { importing.current = value; callbacks.current.onBusy(value); }} />
    {error && <div role="alert" className="daily-error"><p>{error}</p><Button size="sm" variant="outline" onClick={() => { void flush(); }}>重试保存</Button><Button size="sm" variant="ghost" onClick={() => {
      void journalRepository.list().then(records => {
        const saved = records.find(value => value.kind === kind && value.start === start);
        persist(); setRecovery({ doc: current.current, revision: revision.current }); recovering.current = true;
        const doc = journalDocument(saved); current.current = doc; baseline.current = JSON.stringify(doc); revision.current = saved?.contentRevision ?? 0;
        editor.current?.commands.setContent(doc, { emitUpdate: false }); callbacks.current.onDirty(false); setError(""); setStatus("已读取已保存内容");
      }).catch(cause => setError(String(cause)));
    }}>读取已保存内容</Button></div>}
  </section>;
}
