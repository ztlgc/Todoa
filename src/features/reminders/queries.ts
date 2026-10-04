import { invoke } from "@tauri-apps/api/core";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { reminderRepository } from "@/data/repositories/ReminderRepository";
export const reminderKeys={all:["reminders"] as const,task:(id:number)=>["reminders",id] as const};
export function useReminders(id:number) { return useQuery({queryKey:reminderKeys.task(id),queryFn:()=>reminderRepository.list(id),networkMode:"always"}); }
export function useWriteReminder(taskId:number) {
  const client=useQueryClient();
  return useMutation({mutationFn:async (input:{action:"create"|"edit"|"delete";id?:number;time?:string})=>{ await (input.action==="create"?reminderRepository.create(taskId,input.time!):input.action==="edit"?reminderRepository.edit(input.id!,input.time!):reminderRepository.delete(input.id!)); },networkMode:"always",retry:0,onSuccess:()=>client.invalidateQueries({queryKey:reminderKeys.task(taskId)})});
}

export function useSchedulerStatus() { return useQuery({queryKey:[...reminderKeys.all,"scheduler-status"],queryFn:()=>invoke<string>("reminder_scheduler_status"),networkMode:"always",retry:0}); }
