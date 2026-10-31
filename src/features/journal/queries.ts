import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { journalRepository } from "@/data/repositories/JournalRepository";
import type { JournalInput, JournalKind, JournalRecord } from "@/domain/journal";
import { journalReviewRepository } from "@/data/repositories/JournalReviewRepository";
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
export function useJournalDetail(kind: JournalKind, start: string, enabled = true) {
  return useQuery({ queryKey: [...key, "detail", kind, start], queryFn: () => journalRepository.get(kind, start).then(value => value ?? null), enabled, networkMode: "always" });
}
export function useJournalIndex(from: string, to: string) {
  return useQuery({ queryKey: [...key, "index", from, to], queryFn: () => journalRepository.index(from, to), networkMode: "always" });
}
export function useJournalRange(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: [...key, "range", from, to], queryFn: () => journalRepository.range(from, to), enabled, networkMode: "always" });
}
export function useJournalHighlights(from: string, to: string) {
  return useQuery({ queryKey: [...key, "highlights", from, to], queryFn: () => journalReviewRepository.list(from, to), networkMode: "always" });
}
export function useJournalMaterials(kind: "month" | "year", start: string, enabled: boolean) {
  return useQuery({ queryKey: [...key, "materials", kind, start], queryFn: () => journalReviewRepository.materials(kind, start), enabled, networkMode: "always" });
}
export function useSaveJournal() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ input, revision }: { input: JournalInput; revision: number }) => journalRepository.save(input, revision), networkMode: "always", retry: 0, onSuccess: () => client.invalidateQueries({ queryKey: key }) });
}
export function useRemoveJournal() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (record: JournalRecord) => journalRepository.remove(record), networkMode: "always", retry: 0, onSuccess: () => client.invalidateQueries({ queryKey: key }) });
}
