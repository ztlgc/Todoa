import { useId } from "react";
import { activityNames, bankingBusinesses, statusNames, type JournalItem } from "@/domain/journal";

export function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
export function inputTime(value: string) { return value ? new Date(value).toISOString() : null; }
export function newWorkItem(): JournalItem {
  return { id: crypto.randomUUID(), title: "", notes: "", theme: "", important: false, taskId: null, completedAt: null, client: "", business: "", activity: "phone", status: "progress", nextAction: "", followUpAt: null };
}
export function WorkItemFields({ item, onChange, clients, prefix, followUp = true }: { item: JournalItem; onChange: (patch: Partial<JournalItem>) => void; clients: string[]; prefix: string; followUp?: boolean }) {
  const id = useId();
  return <>
    <div className="jp-field-grid">
      <label className="jp-field">客户<input aria-label={`${prefix}客户`} placeholder="企业名称" maxLength={200} list={`${id}-clients`} value={item.client ?? ""} onChange={event => onChange({ client: event.target.value })} /><datalist id={`${id}-clients`}>{clients.map(client => <option key={client} value={client} />)}</datalist></label>
      <label className="jp-field">业务类型<input aria-label={`${prefix}业务类型`} placeholder="例如：授信申报" maxLength={100} list={`${id}-business`} value={item.business ?? ""} onChange={event => onChange({ business: event.target.value })} /><datalist id={`${id}-business`}>{bankingBusinesses.map(business => <option key={business} value={business} />)}</datalist></label>
      <label className="jp-field">记录类型<select aria-label={`${prefix}记录类型`} value={item.activity ?? "other"} onChange={event => onChange({ activity: event.target.value as JournalItem["activity"] })}>{Object.entries(activityNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <label className="jp-field">事项状态<select aria-label={`${prefix}状态`} value={item.status ?? (item.completedAt ? "completed" : "unclassified")} onChange={event => onChange({ status: event.target.value as JournalItem["status"] })}>{Object.entries(statusNames).filter(([value]) => value !== "revoked").map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
    </div>
    {followUp && <div className="jp-field-grid jp-followup-fields">
      <label className="jp-field">下一步跟进<input aria-label={`${prefix}下一步`} placeholder="例如：联系财务补齐季度报表" maxLength={500} value={item.nextAction ?? ""} onChange={event => onChange({ nextAction: event.target.value })} /></label>
      <label className="jp-field">跟进时间<input type="datetime-local" aria-label={`${prefix}跟进时间`} value={localDateTime(item.followUpAt)} onInput={event => onChange({ followUpAt: inputTime(event.currentTarget.value) })} onChange={event => onChange({ followUpAt: inputTime(event.target.value) })} /></label>
    </div>}
  </>;
}
