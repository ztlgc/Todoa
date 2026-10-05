import { watchMainReminderEvents } from "./mainReminderEvents";
import { useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createLocalQueryClient } from "./queryClient";
import { watchMainQueryRefresh } from "./mainQueryRefresh";
import { watchMainTaskEvents } from "./mainTaskEvents";
import { isBrowserDebug } from "./browserDebug";

// App mounts this provider only inside the successful DatabaseGate.
export function MainQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createLocalQueryClient);
  useEffect(() => {
    if (isBrowserDebug()) return;
    const stopRefresh = watchMainQueryRefresh(client);
    const stopReminders=watchMainReminderEvents(client);
    const stopEvents = watchMainTaskEvents(client);
    return () => { stopReminders(); stopEvents(); stopRefresh(); };
  }, [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
