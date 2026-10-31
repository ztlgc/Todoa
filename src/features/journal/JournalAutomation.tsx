import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isBrowserDebug } from "@/app/browserDebug";
import { browserListRepository, browserTaskRepository } from "@/data/browserRepositories";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { pruneUnusedJournalImages } from "@/data/journalImageMaintenance";

// Mounted after DatabaseGate, independently of the selected workspace.
export function JournalAutomation() {
  const client = useQueryClient();
  const reconcile = useQuery({ queryKey: ["journal-automation"], networkMode: "always", retry: false, staleTime: Infinity,
    queryFn: async () => {
      if (isBrowserDebug()) {
        const [active, trash, lists] = await Promise.all([browserTaskRepository.list(), browserTaskRepository.list({ deleted: true }), browserListRepository.list()]);
        await journalRepository.reconcile([...active, ...trash], lists);
      } else await journalRepository.reconcile();
      await client.invalidateQueries({ queryKey: ["journal"] });
      // Maintenance failure must not hide tasks or claim reconciliation failed.
      void pruneUnusedJournalImages().catch(() => console.error("JOURNAL_IMAGE_CLEANUP_DEFERRED"));
      return true;
    },
  });
  if (!reconcile.isError) return null;
  return <div className="mb-4 flex items-center gap-3 text-sm" role="alert"><span>自动日记补录失败，已有记录保留。</span><button className="underline" disabled={reconcile.isFetching} onClick={() => void reconcile.refetch()}>重试补录</button></div>;
}
