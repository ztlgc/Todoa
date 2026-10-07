import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { journalRepository } from "@/data/repositories/JournalRepository";
import type { JournalInput, JournalRecord } from "@/domain/journal";
const key = ["journal"] as const;
export function useJournalRecords() { return useQuery({ queryKey: key, queryFn: () => journalRepository.list(), networkMode: "always" }); }
export function useSaveJournal() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ input, revision }: { input: JournalInput; revision: number }) => journalRepository.save(input, revision), networkMode: "always", retry: 0, onSuccess: () => client.invalidateQueries({ queryKey: key }) });
}
export function useRemoveJournal() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (record: JournalRecord) => journalRepository.remove(record), networkMode: "always", retry: 0, onSuccess: () => client.invalidateQueries({ queryKey: key }) });
}
