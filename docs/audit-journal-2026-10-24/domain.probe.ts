import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { documentMarkdown, parseJournalDocument } from "@/domain/journalContent";
import type { JSONContent } from "@tiptap/react";

it("CONFIRMED: eight nested lists read one image 256 times during Markdown export", async () => {
  let node: JSONContent = { type: "image", attrs: { src: "todoa-asset:1" } };
  for (let index = 0; index < 8; index++) node = { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "事项" }] }, node] }] };
  const doc = { type: "doc", content: [node] };
  parseJournalDocument(doc);
  let reads = 0;
  const started = performance.now();
  const output = await documentMarkdown(doc, async () => { reads++; return "data:image/png;base64,AA=="; });
  expect(output.match(/data:image/g)).toHaveLength(1);
  expect(reads).toBe(256);
  console.log(JSON.stringify({ probe: "nested-list-export", nesting: 8, imageNodes: 1, reads, milliseconds: performance.now() - started }));
});

it("CONFIRMED SQL: replacing a rich document leaves removed images in journal_assets", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of ["0005_journal.sql", "0007_journal_task_completions.sql", "0008_journal_content.sql"]) db.exec(readFileSync(new URL(`../../src-tauri/migrations/${name}`, import.meta.url), "utf8"));
  db.prepare("INSERT INTO journal_records(kind,period_start,period_end,created_at,updated_at) VALUES('day','2026-10-24','2026-10-24','now','now')").run();
  db.prepare("INSERT INTO journal_assets(kind,period_start,mime,data) VALUES('day','2026-10-24','image/png',?)").run(Buffer.from([137,80,78,71,13,10,26,10]));
  // Execute the production UPDATE text directly; the Rust service does no DELETE around it.
  const source = readFileSync(new URL("../../src-tauri/src/services/journal_content.rs", import.meta.url), "utf8");
  const statement = source.match(/sqlx::query\("(UPDATE journal_records SET body=\?[^"\n]+)"\)/)?.[1];
  expect(statement).toBeTruthy();
  db.prepare(statement!).run("图片已移除", JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "图片已移除" }] }] }), "now", "day", "2026-10-24");
  expect(db.prepare("SELECT count(*) AS count FROM journal_assets").get()?.count).toBe(1);
  console.log(JSON.stringify({ probe: "removed-image-retention", documentImages: 0, retainedAssets: 1, scope: "production SQL plus migrations, not full Rust service" }));
  db.close();
});

it("CONFIRMED: Markdown export changes code-block whitespace", async () => {
  const doc = { type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "第一行\n第二行  \n" }] }] };
  const output = await documentMarkdown(doc, async () => "");
  expect(output).toBe("```\n第一行\n第二行\n```");
  console.log(JSON.stringify({ probe: "code-whitespace", input: doc.content[0].content[0].text, output }));
});

it("CONFIRMED browser domain: the stated 200000-character limit is accepted", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "字".repeat(200000) }] }] };
  expect(parseJournalDocument(doc).text.length).toBe(200000);
  console.log(JSON.stringify({ probe: "browser-length-limit", visibleUtf16Characters: 200000, accepted: true }));
});

it.each(["Asia/Shanghai", "America/New_York", "Europe/London"])("CONTROL: natural periods stay correct across leap years, year boundaries and DST in %s", zone => {
  const moduleUrl = pathToFileURL(resolve("src/domain/journal.ts")).href;
  const source = `import { journalPeriod } from ${JSON.stringify(moduleUrl)};
    const actual = [journalPeriod('week','2026-01-01'),journalPeriod('month','2024-02-29'),journalPeriod('month','2025-02-28'),journalPeriod('week','2026-03-08'),journalPeriod('week','2026-11-01')];
    console.log(JSON.stringify(actual));`;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", source], { env: { ...process.env, TZ: zone }, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    { kind: "week", start: "2025-12-29", end: "2026-01-04" },
    { kind: "month", start: "2024-02-01", end: "2024-02-29" },
    { kind: "month", start: "2025-02-01", end: "2025-02-28" },
    { kind: "week", start: "2026-03-02", end: "2026-03-08" },
    { kind: "week", start: "2026-10-26", end: "2026-11-01" },
  ]);
  console.log(JSON.stringify({ probe: "period-boundaries", zone, cases: 5, passed: true }));
});
