import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listRepository } from "@/data/repositories/ListRepository";
import { invalidateTaskCaches } from "@/features/tasks/queries";
import { listKeys } from "./queryKeys";

export function useLists() {
  return useQuery({ queryKey: listKeys.collection(), queryFn: () => listRepository.list(), networkMode: "always" });
}

export function useCreateList() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (name: string) => listRepository.create(name), networkMode: "always", retry: 0,
    onSuccess: () => invalidateTaskCaches(client) });
}

export function useRenameList() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, name }: { id: number; name: string }) => listRepository.rename(id, name), networkMode: "always", retry: 0,
    onSuccess: () => invalidateTaskCaches(client) });
}

export function useDeleteList() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => listRepository.delete(id), networkMode: "always", retry: 0,
    onSuccess: () => invalidateTaskCaches(client) });
}
