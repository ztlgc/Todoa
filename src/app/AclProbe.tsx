import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

type ProbeResult = { command: string; outcome: string };

async function attempt(command: string, action: () => Promise<unknown>): Promise<ProbeResult> {
  try {
    await action();
    return { command, outcome: "UNEXPECTED_ALLOW" };
  } catch (error) {
    return { command, outcome: String(error) };
  }
}

export default function AclProbe() {
  const [results, setResults] = useState<ProbeResult[]>([]);

  useEffect(() => {
    const database = Database.get("sqlite:todo.db");
    Promise.all([
      attempt("database_boot_status", () => invoke("database_boot_status")),
      attempt("sql:select", () => database.select("PRAGMA user_version")),
      attempt("sql:execute", () => database.execute("SELECT 1")),
    ]).then(setResults);
  }, []);

  return (
    <main className="space-y-3 p-6">
      <h1 className="text-xl font-semibold">隔离 ACL 验收窗口</h1>
      <p>本窗口没有 Capability。以下调用都应被 Tauri 权限层拒绝。</p>
      <ul className="space-y-2 text-sm">
        {results.map(({ command, outcome }) => (
          <li key={command}>{command}: {outcome}</li>
        ))}
      </ul>
    </main>
  );
}
