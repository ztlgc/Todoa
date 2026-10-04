import { invoke } from "@tauri-apps/api/core";
import type { SqlDatabase } from "./SqlDatabase";

export function withMainWriteLeases(database: SqlDatabase): SqlDatabase {
  return {
    select: (query, values) => database.select(query, values),
    async execute(query, values) {
      const id = await invoke<number>("begin_main_write");
      try { return await database.execute(query, values); }
      finally {
        // A lost acknowledgment must not turn an already committed SQL write into
        // a creation failure. Rust also drains the actual pool before exiting.
        await invoke("finish_main_write", { id }).catch(() => console.error("WRITE_LEASE_RELEASE_FAILED"));
      }
    },
  };
}
