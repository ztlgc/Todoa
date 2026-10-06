import type { TaskPriority } from "@/domain/task";

export const taskPriorities: { value: TaskPriority; label: string; color: string; checkbox: string }[] = [
  { value: "high", label: "高优先级", color: "text-red-500", checkbox: "border-red-500 data-checked:border-red-500 data-checked:bg-red-500 dark:data-checked:bg-red-500" },
  { value: "medium", label: "中优先级", color: "text-amber-500", checkbox: "border-amber-500 data-checked:border-amber-500 data-checked:bg-amber-500 dark:data-checked:bg-amber-500" },
  { value: "low", label: "低优先级", color: "text-blue-500", checkbox: "border-blue-500 data-checked:border-blue-500 data-checked:bg-blue-500 dark:data-checked:bg-blue-500" },
  { value: "none", label: "无优先级", color: "text-muted-foreground", checkbox: "" },
];

export function priorityMeta(priority: TaskPriority | undefined) {
  return taskPriorities.find(item => item.value === (priority ?? "none")) ?? taskPriorities[3];
}
