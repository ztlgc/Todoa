import type { TaskStatus } from "@/domain/task";

export interface TaskQueryScope {
  view: "all" | "inbox" | "list" | "tag" | "today" | "upcoming" | "trash";
  listId?: number | null;
  tagId?: number;
  status?: TaskStatus;
  deleted?: boolean;
  dateRange?: { from: string; to?: string };
}

export const taskKeys = {
  all: ["tasks"] as const,
  lists: () => ["tasks", "lists"] as const,
  list: (scope: TaskQueryScope) => ["tasks", "lists", {
    view: scope.view,
    listId: scope.listId,
    tagId: scope.tagId,
    status: scope.status,
    deleted: scope.deleted,
    dateRange: scope.dateRange,
  }] as const,
  details: () => ["tasks", "details"] as const,
  detail: (id: number) => ["tasks", "details", id] as const,
  counts: () => ["tasks", "counts"] as const,
};
