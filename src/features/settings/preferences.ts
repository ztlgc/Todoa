import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isBrowserDebug } from "@/app/browserDebug";

export const preferenceDefaults = {
  calendarEnabled: true, journalEnabled: true, notificationsEnabled: true,
  showTaskTitle: true,
};
export type AppPreferences = typeof preferenceDefaults;
export const preferencesStorageKey = "todoa.preferences.v1";
const key = ["app-preferences"] as const;
export function parsePreferences(raw: unknown): AppPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("PREFERENCES_INVALID");
  const p = { ...preferenceDefaults };
  for (const field of Object.keys(p) as (keyof AppPreferences)[]) {
    if (field in raw) {
      const value = (raw as Record<string, unknown>)[field];
      if (typeof value !== "boolean") throw new Error("PREFERENCES_INVALID");
      p[field] = value;
    }
  }
  return p;
}
export const preferencesRepository = {
  async read(): Promise<AppPreferences> {
    if (!isBrowserDebug()) return parsePreferences(await invoke("get_app_preferences"));
    const raw = localStorage.getItem(preferencesStorageKey);
    return raw === null ? { ...preferenceDefaults } : parsePreferences(JSON.parse(raw));
  },
  async save(input: AppPreferences): Promise<AppPreferences> {
    const parsed = parsePreferences(input);
    if (!isBrowserDebug()) return parsePreferences(await invoke("set_app_preferences", { input: parsed }));
    localStorage.setItem(preferencesStorageKey, JSON.stringify(parsed));
    return parsed;
  },
};
export function useAppPreferences() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: preferencesRepository.read });
  const save = useMutation({ mutationFn: preferencesRepository.save, onSuccess: value => client.setQueryData(key, value) });
  return { query, save };
}
