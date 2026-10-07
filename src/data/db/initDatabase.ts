import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { SqlDatabase } from "./SqlDatabase";
import { withMainWriteLeases } from "./mainWriteLease";

const DATABASE_URL = "sqlite:todo.db";
const SCHEMA_VERSION = 4;

let initialization: Promise<SqlDatabase> | undefined;

export function initDatabase(): Promise<SqlDatabase> {
  initialization ??= (async () => {
    const readyVersion = await invoke<number>("database_boot_status");
    if (readyVersion !== SCHEMA_VERSION) {
      throw new Error("SCHEMA_VERSION_MISMATCH");
    }

    const database = Database.get(DATABASE_URL);
    const rows = await database.select<Array<{ user_version: number }>>(
      "PRAGMA user_version",
    );
    if (rows.length !== 1 || rows[0].user_version !== SCHEMA_VERSION) {
      throw new Error("SCHEMA_VERSION_MISMATCH");
    }
    return withMainWriteLeases(database);
  })();
  return initialization;
}
