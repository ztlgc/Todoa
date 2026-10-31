import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { JournalRepository } from "@/data/repositories/JournalRepository";
import { journalSearchText, periodJournalRecords } from "@/domain/journalContent";
import { plainDocument } from "@/domain/contentDocument";
import type { SqlDatabase, SqlValue } from "@/data/db/SqlDatabase";

it("measures the current SQLite/repository and search paths with one and five years of fictional work", async () => {
  const results: unknown[] = [];
  for (const days of [365, 1826]) {
    const db = new DatabaseSync(":memory:");
    for (const file of ["0001_initial.sql", "0002_natural_schedule.sql", "0003_task_priority.sql", "0004_task_trash.sql", "0005_journal.sql", "0006_task_content.sql", "0007_journal_task_completions.sql", "0008_journal_content.sql"])
      db.exec(readFileSync(new URL(`../../src-tauri/migrations/${file}`, import.meta.url), "utf8"));
    const record = db.prepare("INSERT INTO journal_records(kind,period_start,period_end,body,content_json,content_revision,created_at,updated_at) VALUES('day',?,?,?,?,1,?,?)");
    const completion = db.prepare("INSERT INTO journal_task_completions(id,day,task_id,task_created_at,completed_at,title,notes) VALUES(?,?,?,?,?,?,?)");
    const start = new Date("2021-10-25T12:00:00Z"), created = "2021-10-01T01:00:00.000Z";
    db.exec("BEGIN");
    for (let index = 0; index < days; index++) {
      const date = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10), stamp = `${date}T01:00:00.000Z`;
      const text = (index % 4 ? "云杉公司" : "青禾公司") + "：客户沟通与资料核对。".repeat(160);
      record.run(date, date, text, JSON.stringify(plainDocument(text)), stamp, stamp);
      for (let item = 0; item < 10; item++) {
        const id = index * 10 + item + 1;
        completion.run(`auto:${id}:${created}:${stamp}`, date, id, created, stamp, `虚构客户事项${id}`, "核对材料和后续跟进。".repeat(40));
      }
    }
    db.exec("COMMIT");
    const adapter: SqlDatabase = {
      async select<T>(query: string, values: SqlValue[] = []) { return db.prepare(query).all(...values) as T; },
      async execute(query, values = []) { const result = db.prepare(query).run(...values); return { rowsAffected: Number(result.changes) }; },
    };
    const repository = new JournalRepository(async () => adapter, () => false);
    const heapBefore = process.memoryUsage().heapUsed, timings: number[] = [];
    let records = await repository.list();
    for (let round = 0; round < 3; round++) {
      const before = performance.now(); records = await repository.list(); timings.push(performance.now() - before);
    }
    expect(records).toHaveLength(days);
    expect(records.reduce((sum, value) => sum + value.items.length, 0)).toBe(days * 10);
    const searching = performance.now();
    const matches = records.filter(record => journalSearchText(record).includes("青禾"));
    const searchMilliseconds = performance.now() - searching;
    const filtering = performance.now(); const period = periodJournalRecords(records, "year", records[0].start);
    const rangeMilliseconds = performance.now() - filtering;
    const bytes = Number(db.prepare("PRAGMA page_count").get()!.page_count) * Number(db.prepare("PRAGMA page_size").get()!.page_size);
    results.push({ days, completionSnapshots: days * 10, databaseBytes: bytes, listMilliseconds: timings.map(value => +value.toFixed(2)), searchMilliseconds: +searchMilliseconds.toFixed(2), matches: matches.length, rangeMilliseconds: +rangeMilliseconds.toFixed(2), rangeDays: period.length, heapDeltaMiB: +((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024).toFixed(2) });
    db.close();
  }
  const output = { date: "2026-10-25", scope: "SQLite in memory, actual repository mapping and domain search; no Tauri IPC, GUI rendering or image decoding; heap delta is not peak memory", results };
  writeFileSync(new URL("history-benchmark.json", import.meta.url), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
});
