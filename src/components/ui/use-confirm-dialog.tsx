import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

// WebView native JavaScript confirm is not a reliable desktop interaction.
export function useConfirmDialog() {
  const [request, setRequest] = useState<{ message: string; accept: string }>();
  const resolve = useRef<((accepted: boolean) => void) | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { resolve.current?.(false); resolve.current = null; }, []);
  function finish(accepted: boolean) { const done = resolve.current; resolve.current = null; setRequest(undefined); done?.(accepted); }
  function confirm(message: string, accept = "放弃输入并继续") {
    if (resolve.current) return Promise.resolve(false);
    return new Promise<boolean>(done => { resolve.current = done; setRequest({ message, accept }); });
  }
  const confirmation = <Dialog open={!!request} onOpenChange={open => { if (!open) finish(false); }}>
    <DialogContent showCloseButton={false} initialFocus={cancel} className="max-h-[90dvh] overflow-y-auto">
      <DialogTitle>确认操作</DialogTitle><DialogDescription>{request?.message}</DialogDescription>
      <div className="flex flex-wrap gap-2"><Button ref={cancel} variant="outline" onClick={() => finish(false)}>继续编辑</Button><Button variant="destructive" onClick={() => finish(true)}>{request?.accept}</Button></div>
    </DialogContent>
  </Dialog>;
  return { confirm, confirmation };
}
