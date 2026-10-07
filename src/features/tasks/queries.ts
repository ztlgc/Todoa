import { reminderKeys } from "@/features/reminders/queries";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { taskRepository } from "@/data/repositories/TaskRepository";
import { parseTaskFilters, type CreateTaskInput, type TaskFilters, type TaskStatus, type UpdateTaskInput } from "@/domain/task";
import { taskKeys } from "./queryKeys";
import { listKeys } from "@/features/lists/queryKeys";
import { tagKeys } from "@/features/tags/queryKeys";

export async function invalidateTaskCaches(client: QueryClient, id?: number) {
  await Promise.all([
    client.invalidateQueries({ queryKey: taskKeys.lists() }),
    id === undefined ? client.invalidateQueries({ queryKey: taskKeys.details() }) : client.invalidateQueries({ queryKey: taskKeys.detail(id), exact: true }),
    client.invalidateQueries({ queryKey: taskKeys.counts() }),
    client.invalidateQueries({ queryKey: listKeys.all }),
    client.invalidateQueries({ queryKey: tagKeys.all }),
    client.invalidateQueries({ queryKey: reminderKeys.all }),
  ]);
}

export function useTasks(filters: TaskFilters = {}) {
  const scope = parseTaskFilters(filters);
  return useQuery({
    queryKey: taskKeys.list({
      view: scope.deleted ? "trash" : scope.dateView ?? (scope.tagId !== undefined ? "tag" : scope.listId === null ? "inbox" : scope.listId === undefined ? "all" : "list"),
      ...scope,
    }),
    queryFn: () => taskRepository.list(filters),
    networkMode: "always",
  });
}

export function useTask(id: number) {
  return useQuery({ queryKey: taskKeys.detail(id), queryFn: () => taskRepository.getById(id), networkMode: "always" });
}
export function useUpdateTask() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, input }: { id: number; input: UpdateTaskInput }) => taskRepository.update(id, input),
    networkMode: "always", retry: 0, onSuccess: (_task, { id }) => invalidateTaskCaches(client, id) });
}

export function useCreateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => taskRepository.create(input),
    networkMode: "always",
    retry: 0,
    onSuccess: (task) => invalidateTaskCaches(client, task.id),
  });
}

export function useUpdateTaskStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) => taskRepository.updateStatus(id, status),
    networkMode: "always",
    retry: 0,
    onSuccess: (_data, { id }) => invalidateTaskCaches(client, id),
  });
}

export function useDeleteTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => taskRepository.delete(id),
    networkMode: "always",
    retry: 0,
    onSuccess: (_data, id) => invalidateTaskCaches(client, id),
  });
}

export function useTrashTask() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => taskRepository.trash(id), networkMode: "always", retry: 0,
    onSuccess: (_data, id) => invalidateTaskCaches(client, id) });
}

export function useRestoreTask() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => taskRepository.restore(id), networkMode: "always", retry: 0,
    onSuccess: (_data, id) => invalidateTaskCaches(client, id) });
}

export function useSetTaskList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, listId }: { id: number; listId: number | null }) => taskRepository.setList(id, listId),
    networkMode: "always", retry: 0,
    onSuccess: (_data, { id }) => invalidateTaskCaches(client, id),
  });
}
