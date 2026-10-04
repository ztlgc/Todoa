import { invoke } from "@tauri-apps/api/core";
import { initDatabase } from "@/data/db/initDatabase";
import { parseTaskId, parseTaskTime } from "@/domain/task";
import type { SqlDatabase } from "@/data/db/SqlDatabase";
export interface Reminder { id:number; taskId:number; remindAt:string; triggeredAt:string|null; }
export function futureTime(value:string, now=Date.now()) {
  const time=parseTaskTime(value);
  if (Date.parse(time)<=now) throw new Error("请选择未来时刻。");
  return time;
}
export class ReminderRepository {
  constructor(private readonly database:()=>Promise<SqlDatabase>=initDatabase, private readonly command:typeof invoke=invoke) {}
  async list(taskId:number):Promise<Reminder[]> {
    const rows=await (await this.database()).select<{id:number;task_id:number;remind_at:string;triggered_at:string|null}[]>("SELECT id,task_id,remind_at,triggered_at FROM reminders WHERE task_id=? ORDER BY remind_at,id",[parseTaskId(taskId)]);
    return rows.map(row=>({id:parseTaskId(row.id),taskId:parseTaskId(row.task_id),remindAt:parseTaskTime(row.remind_at),triggeredAt:row.triggered_at===null?null:parseTaskTime(row.triggered_at)}));
  }
  create(taskId:number,remindAt:string) { return this.command<number>("create_reminder",{taskId:parseTaskId(taskId),remindAt:futureTime(remindAt)}); }
  edit(id:number,remindAt:string) { return this.command<void>("edit_reminder",{id:parseTaskId(id),remindAt:futureTime(remindAt)}); }
  delete(id:number) { return this.command<void>("delete_reminder",{id:parseTaskId(id)}); }
}
export const reminderRepository=new ReminderRepository();
