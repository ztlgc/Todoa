export type SqlValue = string | number | null;

// The two repositories share the existing Ready SQL plugin adapter.
export interface SqlDatabase {
  select<T>(query: string, bindValues?: SqlValue[]): Promise<T>;
  execute(query: string, bindValues?: SqlValue[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
}
