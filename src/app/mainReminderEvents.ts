import type { QueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invalidateTaskCaches } from "@/features/tasks/queries";
export function watchMainReminderEvents(client:QueryClient) {
  let disposed=false;let stop:(()=>void)|undefined;
  getCurrentWindow().listen("reminders-changed",()=>{if(!disposed)void invalidateTaskCaches(client).catch(()=>console.error("REMINDER_REFRESH_FAILED"));}).then(unlisten=>{if(disposed)unlisten();else stop=unlisten;}).catch(()=>console.error("REMINDER_LISTEN_FAILED"));
  return ()=>{disposed=true;stop?.();};
}
