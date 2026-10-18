import { isTauri } from "@tauri-apps/api/core";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { journalFollowUpRepository } from "@/data/repositories/JournalFollowUpRepository";
import { browserTaskRepository } from "@/data/browserRepositories";
import { dateKey, emptyJournal, type JournalItem } from "@/domain/journal";

async function prepare() {
  if (!import.meta.env.DEV || isTauri()) throw new Error("此页面仅用于浏览器的独立样本预览。");
  const stored = await journalRepository.list();
  const entries: { date: string; items: Partial<JournalItem>[] }[] = [
    { date: "2026-09-23", items: [{ id: "bank-history", title: "首次了解流动资金周转需求", client: "华兴制造", business: "授信申报", activity: "visit", status: "progress", notes: "与财务负责人了解采购周期和回款情况，约定提供近两年财务报表。后续需结合资料核实业务方案。" }] },
    { date: "2026-10-12", items: [{ id: "bank-monday", title: "梳理续贷资料清单", client: "华兴制造", business: "续贷管理", activity: "business", status: "completed", notes: "核对现有资料，向客户列明季度财报、应收账款明细和订单资料，客户确认由财务部统一整理。" }] },
    { date: "2026-10-15", items: [{ id: "bank-open-account", title: "完成开户资料初步核对", client: "远航贸易", business: "开户结算", activity: "business", status: "completed", notes: "已完成资料初步核对，具体办理进度以后续业务流程结果为准。" }, { id: "bank-review", title: "协调授信补充说明", client: "丰禾农业", business: "授信申报", activity: "internal", status: "waiting_internal", notes: "补充季节性采购安排说明，等待内部反馈；尚未取得授信批复。", nextAction: "确认补充说明的反馈", followUpAt: "2026-10-19T02:00:00.000Z" }] },
    { date: "2026-10-16", items: [{ id: "bank-call", title: "确认续贷资料，尚缺应收账款明细", client: "华兴制造", business: "续贷管理", activity: "phone", status: "waiting_client", notes: "王经理反馈三季度财报已在整理。已明确还需应收账款明细，并约定下周一联系确认。", nextAction: "联系财务补齐季度财报与应收明细", followUpAt: "2026-10-19T01:00:00.000Z", important: true }, { id: "bank-deposit", title: "沟通近期结算与资金安排", client: "远航贸易", business: "存款维护", activity: "phone", status: "progress", notes: "客户反馈近期有货款回笼，具体时间待财务确认；仅记录客户沟通情况。" }] },
    { date: "2026-10-17", items: [{ id: "bank-post-loan", title: "完成贷后回访并归档工作记录", client: "青禾物流", business: "贷后管理", activity: "visit", status: "completed", notes: "回访了解经营与回款近况，整理沟通纪要，待补充资料另行安排跟进。" }] },
  ];
  for (const entry of entries) {
    if (stored.some(record => record.kind === "day" && record.start === entry.date)) continue;
    const items: JournalItem[] = entry.items.map((item, index) => ({ id: `bank-${entry.date}-${index}`, title: "", notes: "", taskId: null, completedAt: null, theme: "", important: false, occurredAt: new Date(`${entry.date}T10:30:00+08:00`).toISOString(), ...item }));
    await journalRepository.save({ ...emptyJournal("day", entry.date), items }, 0);
  }
  for (const record of (await journalRepository.list()).filter(record => !record.deletedAt && record.kind === "day")) {
    for (const item of record.items.filter(item => item.nextAction)) await journalFollowUpRepository.create(record.start, item);
  }
  const title = "青禾物流 · 整理贷后回访记录";
  if (!stored.some(record => record.kind === "day" && record.start === dateKey(new Date()) && record.items.some(item => item.origin === "task_auto" && item.title === title))) {
    const task = await browserTaskRepository.create({ title, notes: "已完成回访，归档纪要。" });
    await browserTaskRepository.updateStatus(task.id, "completed");
  }
  const status = document.getElementById("fixture-status");
  if (status) status.textContent = "客户与事项均为虚构。点击「日记」查看；按客户可回看跨月记录。与原有日记及桌面数据隔离，已有编辑保留。";
}
try { await prepare(); }
catch (cause) { const status = document.getElementById("fixture-status"); if (status) { status.setAttribute("role", "alert"); status.textContent = `样本载入失败：${cause instanceof Error ? cause.message : String(cause)}。已有日记保留。`; } }
await import("../windows/main");
