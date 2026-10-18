import { Button } from "@/components/ui/button";
import type { NaturalTaskInput } from "@/domain/naturalTaskInput";

export function TaskInputFeedback({ draft, parsed, ignoreRecognition, onIgnoreChange }: {
  draft: string; parsed: NaturalTaskInput | null; ignoreRecognition: boolean; onIgnoreChange: (value: boolean) => void;
}) {
  if (!draft.trim()) return <p className="text-xs text-muted-foreground">可输入“明天下午3点拜访客户”“每周一整理贷后资料”或“30分钟后提醒我联系财务”。</p>;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
    <span>日期：{parsed?.label ?? (ignoreRecognition ? "已保留原文" : "未识别")}</span>
    <span>重复：{parsed?.repeatRule ? parsed.repeatText : "无"}</span>
    <span>提醒：{parsed?.remindAt.length ? parsed.remindAt.map(time => new Date(time).toLocaleString("zh-CN")).join("、") : "无"}</span>
    {parsed?.matchedText && <Button type="button" size="sm" variant="ghost" onClick={() => onIgnoreChange(true)}>保留原文</Button>}
    {ignoreRecognition && <Button type="button" size="sm" variant="ghost" onClick={() => onIgnoreChange(false)}>重新识别日期</Button>}
  </div>;
}
