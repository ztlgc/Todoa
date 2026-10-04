import {describe,it,expect,vi} from "vitest";
import {ReminderRepository,futureTime} from "./ReminderRepository";
import type {SqlDatabase} from "@/data/db/SqlDatabase";
describe("ReminderRepository",()=>{
  it("validates future times and maps read rows; writes use only narrow commands",async()=>{
    const future=new Date(Date.now()+3_600_000).toISOString();
    const select=vi.fn(async()=>[{id:1,task_id:2,remind_at:future,triggered_at:null}]);
    const execute=vi.fn();const command=vi.fn(async()=>1);
    const r=new ReminderRepository(async()=>({select,execute}) as unknown as SqlDatabase,command as never);
    expect(await r.list(2)).toEqual([{id:1,taskId:2,remindAt:future,triggeredAt:null}]);
    await r.create(2,future);expect(command).toHaveBeenLastCalledWith("create_reminder",{taskId:2,remindAt:future});
    await r.edit(1,future);expect(command).toHaveBeenLastCalledWith("edit_reminder",{id:1,remindAt:future});
    await r.delete(1);expect(command).toHaveBeenLastCalledWith("delete_reminder",{id:1});expect(execute).not.toHaveBeenCalled();
    expect(()=>r.create(0,future)).toThrow();expect(()=>r.edit(1,"2000-01-01T00:00:00Z")).toThrow();
    expect(()=>futureTime("bad")).toThrow();expect(()=>futureTime("2026-10-04T00:00:00.000Z",Date.parse("2026-10-04T00:00:00.000Z"))).toThrow();
  });
});
