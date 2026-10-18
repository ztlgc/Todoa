import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function TaskLinkDialog({ initialHref, returnTo, onApply, onClosed }: {
  initialHref: string;
  returnTo: HTMLElement | null;
  onApply: (href: string) => void;
  onClosed: () => void;
}) {
  const [href, setHref] = useState(initialHref);
  const [error, setError] = useState("");
  const errorId = useId();
  const composing = useRef(false);
  function apply() {
    const value = href.trim();
    if (value) {
      try {
        const url = new URL(value);
        if (!["http:", "https:", "mailto:"].includes(url.protocol) || (url.protocol === "mailto:" && !url.pathname)) throw new Error();
      } catch {
        setError("请输入有效的 http、https 或 mailto 链接。");
        return;
      }
    }
    onApply(value);
    onClosed();
  }
  return <Dialog open onOpenChange={open => { if (!open && !composing.current) onClosed(); }}>
    <DialogContent data-task-popover finalFocus={() => returnTo} className="sm:max-w-sm" onKeyDownCapture={event => {
      if (event.key === "Escape" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); }
    }}>
      <DialogTitle>设置链接</DialogTitle>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!composing.current) apply(); }}>
        <label className="grid gap-1.5 text-sm">链接地址
          <Input autoFocus autoComplete="off" aria-label="链接地址" placeholder="https://…" value={href} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
            onChange={event => { setHref(event.target.value); setError(""); }}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={event => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
        </label>
        {error && <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {initialHref && <Button type="button" variant="ghost" onClick={() => { onApply(""); onClosed(); }}>移除链接</Button>}
          <Button type="button" variant="outline" onClick={onClosed}>取消</Button>
          <Button type="submit">保存链接</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
