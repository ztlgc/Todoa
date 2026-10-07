import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tagRepository } from "@/data/repositories/TagRepository";
import { invalidateTaskCaches } from "@/features/tasks/queries";
import { tagKeys } from "./queryKeys";

export function useTags() {
  return useQuery({ queryKey: tagKeys.collection(), queryFn: () => tagRepository.list(), networkMode: "always" });
}
export function useTaskTags() {
  return useQuery({ queryKey: tagKeys.taskTags(), queryFn: () => tagRepository.listTaskTags(), networkMode: "always" });
}
export function useCreateTag() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (name: string) => tagRepository.create(name), networkMode: "always", retry: 0,
    onSuccess: () => invalidateTaskCaches(client) });
}
export function useRenameTag() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, name }: { id: number; name: string }) => tagRepository.rename(id, name), networkMode: "always", retry: 0,
    onSuccess: () => invalidateTaskCaches(client) });
}
export function useAssignTag() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ taskId, tagId }: { taskId: number; tagId: number }) => tagRepository.assign(taskId, tagId), networkMode: "always", retry: 0,
    onSuccess: (_data, { taskId }) => invalidateTaskCaches(client, taskId) });
}
export function useRemoveTag() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ taskId, tagId }: { taskId: number; tagId: number }) => tagRepository.remove(taskId, tagId), networkMode: "always", retry: 0,
    onSuccess: (_data, { taskId }) => invalidateTaskCaches(client, taskId) });
}
export function useDeleteTag() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => tagRepository.delete(id), networkMode: "always", retry: 0,
    onSuccess: () => invalidateTaskCaches(client) });
}
