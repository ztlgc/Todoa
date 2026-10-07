import { BookOpen, CalendarDays, Database, FolderOpen, ListTodo, Zap } from "lucide-react";
import { isBrowserDebug } from "@/app/browserDebug";

const guides = [
  {
    title: "记录与完成任务", icon: ListTodo,
    tips: ["在「收件箱」或清单中输入待办，按回车或点击「添加任务」。", "点击任务标题打开详情，编辑标题和内容；正文支持格式与图片，修改后查看「已保存」状态。", "勾选任务表示完成，在「已完成」中回看；删除的任务可在任务回收站恢复。"],
  },
  {
    title: "日期、提醒与重复", icon: CalendarDays,
    tips: ["可直接输入「明天下午3点开会」等内容，添加前核对识别出的日期与提醒。", "在任务详情的「日期与提醒」中设置日期、时间、提醒和重复规则，点击「确定」应用。", "重复任务完成后生成下一次任务；清除日期会停止重复，并取消未触发的自动提醒。"],
  },
  {
    title: "清单、标签与日历", icon: FolderOpen,
    tips: ["用清单区分项目或生活事项，在任务详情底部选择所属清单；标签用于跨清单分类。", "使用「今天」「即将到来」安排近期工作，并为重要任务设置优先级。", "在「日历」中选择日期查看安排，点击任务打开详情；「设置 → 统计」查看任务完成情况。"],
  },
  {
    title: "日记与年度回顾", icon: BookOpen,
    tips: ["进入「日记」，用左侧日历选择日期，点击「写一笔」记录当天总结；可收录已完成任务，或手写工作进展。", "点击「保存日记」保存修改。收录的任务保留历史快照，之后修改或删除原任务不会改动日记。", "切换日／周／月／年查看记录；阶段总结可「整理本期素材」后编辑保存。用主题、重点和搜索筛选，再导出 Markdown；删除的日记可在日记回收站恢复。"],
  },
  {
    title: "快速添加与后台使用", icon: Zap,
    tips: ["点击顶部「快速添加」随时记录待办；桌面版也支持 Ctrl+Shift+Space 全局快捷键。", "桌面窗口关闭后可从系统托盘重新打开；需要完全退出时使用托盘菜单。", "在「设置 → 常规」按需启用登录后后台启动，窗口尺寸与位置会自动保存。"],
  },
  {
    title: "保存、备份与恢复", icon: Database,
    tips: ["桌面版数据保存在本机，无需账号；建议在「设置 → 数据」定期备份，尤其在恢复其他备份之前。", "备份包含任务、清单、标签、提醒、日记和阶段总结。恢复会替换当前数据并重启应用；窗口与开机启动设置不包含在备份中。", "Markdown 导出用于阅读与分享回顾，不能代替完整备份。备份文件未加密，请妥善保管。"],
  },
];

export function AboutSettings({ version }: { version?: string }) {
  return <div className="mt-5 space-y-6">
    <div className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">Todoa</h2><span className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">版本 {version ?? "读取中…"}</span></div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">把事情记下来，慢慢完成。用任务安排当下，用日记留下成果，在年终回看这一年的工作。</p>
    </div>
    <section aria-labelledby="getting-started-heading" className="rounded-xl border bg-muted/30 p-5">
      <h2 id="getting-started-heading" className="font-semibold">从这里开始</h2>
      <ol className="mt-3 grid list-inside list-decimal gap-3 text-sm leading-6 lg:grid-cols-3">
        <li>在收件箱写下今天要做的事。</li><li>完成后勾选任务，去日记记录成果。</li><li>每周、每月整理总结，年终回看全年。</li>
      </ol>
    </section>
    <section aria-labelledby="usage-guide-heading">
      <h2 id="usage-guide-heading" className="mb-3 font-semibold">使用说明</h2>
      <div className="grid gap-4 xl:grid-cols-2">{guides.map(({ title, icon: Icon, tips }) => <section key={title} className="min-w-0 rounded-xl border bg-card p-5">
        <h3 className="flex items-center gap-2 font-medium"><Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />{title}</h3>
        <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground">{tips.map(tip => <li key={tip}>{tip}</li>)}</ul>
      </section>)}</div>
    </section>
    {isBrowserDebug() && <aside aria-label="浏览器预览数据说明" className="rounded-xl border bg-muted/30 p-4 text-sm leading-6"><strong className="font-medium">当前为浏览器预览</strong><p className="mt-1 text-muted-foreground">任务刷新后会清空；日记保存在当前浏览器中，刷新后保留，清除站点数据会删除这些日记。浏览器与桌面版的数据互相独立，系统提醒、全局快捷键、开机启动和备份恢复需在桌面版使用。</p></aside>}
  </div>;
}
