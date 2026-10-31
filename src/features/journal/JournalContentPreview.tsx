import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/react";
import { journalImageStore } from "@/data/repositories/JournalContentRepository";
import type { ContentImageStore } from "@/domain/contentDocument";
import { journalDocument } from "@/domain/journalContent";
import type { JournalRecord } from "@/domain/journal";

function JournalImage({ store, asset, alt }: { store: ContentImageStore; asset: number; alt: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [url, setUrl] = useState<string>(), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (visible || !root.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    observer.observe(root.current); return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let active = true, object: string | undefined;
    setUrl(undefined); setError(false);
    void store.image(asset).then(blob => {
      object = URL.createObjectURL(blob);
      if (active) setUrl(object); else URL.revokeObjectURL(object);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (object) URL.revokeObjectURL(object); };
  }, [visible, store, asset, retry]);
  return <div className="daily-range-image" ref={root}>{url ? <img src={url} alt={alt} loading="lazy" decoding="async" /> : error ? <button type="button" onClick={() => setRetry(value => value + 1)}>图片加载失败，点击重试</button> : <span>{alt || "日记图片"}</span>}</div>;
}

// Read the saved document directly so a yearly view does not create hundreds of editors.
export function JournalContentPreview({ record }: { record: JournalRecord }) {
  const doc = useMemo(() => journalDocument(record), [record]);
  const store = useMemo(() => journalImageStore(record.kind, record.start), [record.kind, record.start]);
  function render(node: JSONContent, key: string): ReactNode {
    const children = node.content?.map((child, index) => render(child, `${key}-${index}`));
    switch (node.type) {
      case "text": {
        let content: ReactNode = node.text ?? "";
        for (const [index, mark] of (node.marks ?? []).entries()) {
          const markKey = `${key}-mark-${index}`;
          if (mark.type === "bold") content = <strong key={markKey}>{content}</strong>;
          if (mark.type === "italic") content = <em key={markKey}>{content}</em>;
          if (mark.type === "underline") content = <u key={markKey}>{content}</u>;
          if (mark.type === "strike") content = <s key={markKey}>{content}</s>;
          if (mark.type === "highlight") content = <mark key={markKey}>{content}</mark>;
          if (mark.type === "code") content = <code key={markKey}>{content}</code>;
          if (mark.type === "link") content = <a key={markKey} href={String(mark.attrs?.href)} target="_blank" rel="noopener noreferrer">{content}</a>;
        }
        return <Fragment key={key}>{content}</Fragment>;
      }
      case "paragraph": return <p key={key}>{children?.length ? children : <br />}</p>;
      case "heading": return <h3 key={key}>{children}</h3>;
      case "hardBreak": return <br key={key} />;
      case "bulletList": return <ul key={key}>{children}</ul>;
      case "orderedList": return <ol key={key} start={Number(node.attrs?.start) || 1}>{children}</ol>;
      case "listItem": return <li key={key}>{children}</li>;
      case "blockquote": return <blockquote key={key}>{children}</blockquote>;
      case "codeBlock": return <pre key={key}><code>{children}</code></pre>;
      case "horizontalRule": return <hr key={key} />;
      case "image": return <JournalImage key={key} store={store} asset={Number(String(node.attrs?.src).slice(12))} alt={String(node.attrs?.alt ?? "日记图片")} />;
      default: return <Fragment key={key}>{children}</Fragment>;
    }
  }
  return <div className="daily-range-note">{render(doc, "note")}</div>;
}
