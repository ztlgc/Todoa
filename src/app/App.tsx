import { DatabaseGate } from "./DatabaseGate";
import { MainQueryProvider } from "./MainQueryProvider";
import { ListsWorkspace } from "@/features/lists/ListsWorkspace";
import { QuickAddLauncher } from "@/features/quick-add/QuickAddLauncher";
import { LifecycleGate } from "./LifecycleGate";
import { RestoreNotice } from "@/features/settings/BackupRestorePanel";
import { JournalAutomation } from "@/features/journal/JournalAutomation";

function App() {
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-[var(--workspace-max-width)]">
        <RestoreNotice />
        <LifecycleGate><DatabaseGate>
          <MainQueryProvider>
            <JournalAutomation />
            <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4"><div><p className="text-xl font-semibold tracking-tight">Todoa</p><p className="text-xs text-muted-foreground">对公客户经理的客户跟进与工作安排。</p></div><QuickAddLauncher /></header>
            <ListsWorkspace />
          </MainQueryProvider>
        </DatabaseGate></LifecycleGate>
      </div>
    </main>
  );
}

export default App;
