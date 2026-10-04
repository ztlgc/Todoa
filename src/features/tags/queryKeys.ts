export const tagKeys = {
  all: ["tags"] as const,
  collection: () => ["tags", "collection"] as const,
  taskTags: () => ["tags", "task-tags"] as const,
};
