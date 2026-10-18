import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { journalRepository } from "@/data/repositories/JournalRepository";
import type { JournalInput, JournalRecord } from "@/domain/journal";
import { journalFollowUpRepository } from "@/data/repositories/JournalFollowUpRepository";
import { invalidateTaskCaches } from "@/features/tasks/queries";
export const journalKey = ["journal"] as const;
const key = journalKey;
export function useCreateJournalFollowUp() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ date, item }: { date: string; item: JournalInput["items"][number] }) => journalFollowUpRepository.create(date, item), networkMode: "always", retry: 0,
    onSuccess: id => Promise.all([invalidateTaskCaches(client, id), client.invalidateQueries({ queryKey: journalKey })]) });
}
export function useJournalRecords() { return useQuery({ queryKey: key, queryFn: () => journalRepository.list(), networkMode: "always" }); }
export function useSaveJournal() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ input, revision }: { input: JournalInput; revision: number }) => journalRepository.save(input, revision), networkMode: "always", retry: 0, onSuccess: () => client.invalidateQueries({ queryKey: key }) });
}
export function useRemoveJournal() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (record: JournalRecord) => journalRepository.remove(record), networkMode: "always", retry: 0, onSuccess: () => client.invalidateQueries({ queryKey: key }) });
}
