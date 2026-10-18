import { useEffect, useRef, useState } from "react";
import { journalRepository } from "@/data/repositories/JournalRepository";

export function useJournalDraft<T>(scope: string, value: T, dirty: boolean, decode: (value: unknown) => T) {
  const key = `todoa.journal.draft.v2:${journalRepository.draftNamespace ?? "default"}:${scope}`;
  const [initial] = useState(() => {
    try { const raw = localStorage.getItem(key); return { saved: raw ? decode(JSON.parse(raw)) : null, error: "" }; }
    catch { return { saved: null, error: "本地草稿读取失败，已有草稿未被覆盖。" }; }
  });
  const [recovery, setRecovery] = useState<T | null>(initial.saved);
  const [feedback, setFeedback] = useState(initial.error);
  const blocked = useRef(!!initial.error || !!initial.saved);
  const wasDirty = useRef(false);
  const latest = useRef({ value, dirty });
  useEffect(() => { latest.current = { value, dirty }; }, [value, dirty]);
  useEffect(() => {
    if (!dirty) {
      if (wasDirty.current && !blocked.current) { try { localStorage.removeItem(key); setFeedback(""); } catch { setFeedback("旧草稿未能清理。"); } }
      wasDirty.current = false;
      return;
    }
    wasDirty.current = true;
    if (blocked.current) return;
    const write = () => {
      try { localStorage.setItem(key, JSON.stringify(value)); setFeedback("草稿已保存在本机"); }
      catch { setFeedback("草稿保存失败，请及时保存记录，输入仍保留。"); }
    };
    const timer = window.setTimeout(write, 350);
    return () => window.clearTimeout(timer);
  }, [key, value, dirty]);
  // Also retain the last keystroke when changing views or closing the window.
  useEffect(() => {
    const flush = () => { if (latest.current.dirty && !blocked.current) { try { localStorage.setItem(key, JSON.stringify(latest.current.value)); } catch { /* visible feedback already covers unavailable storage */ } } };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [key]);
  function clear() {
    // Mark clean synchronously so unmount cannot bring a saved draft back.
    latest.current.dirty = false;
    blocked.current = false;
    try { localStorage.removeItem(key); setFeedback(""); } catch { setFeedback("记录已保存，本地旧草稿未能清理。"); }
    setRecovery(null);
  }
  function recover() { blocked.current = false; setRecovery(null); try { localStorage.removeItem(key); } catch { /* preserve recoverable input even if storage is unavailable */ } setFeedback("已恢复草稿，请核对后保存。"); return recovery; }
  return { recovery, feedback, clear, recover };
}
