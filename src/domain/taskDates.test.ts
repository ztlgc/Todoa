/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./taskDates";

const sources = Object.fromEntries(["taskDates", "task", "list", "tag"].map(name => [name,
  ts.transpileModule(readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
]));

function calendar(tz: string, instant: string, input?: string) {
  const script = `const sources=${JSON.stringify(sources)}, cache={};function load(name){name=name.replace('./','');if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;new Function('require','module','exports',sources[name])(load,module,module.exports);return module.exports}const {localDayRange,fromLocalInput}=load('taskDates');let rejected=false,converted=null,error=null;try{converted=fromLocalInput(${JSON.stringify(input ?? "")})}catch(e){rejected=true;error=e.name}console.log(JSON.stringify({range:localDayRange(new Date(${JSON.stringify(instant)})),rejected,converted,error}));`;
  return JSON.parse(execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: tz }, encoding: "utf8" }));
}
it("constructs local calendar midnight through 23/25-hour DST days, not fixed UTC dates", () => {
  expect(calendar("Asia/Shanghai", "2026-10-04T18:00:00Z").range).toEqual({ from: "2026-10-04T16:00:00.000Z", to: "2026-10-05T16:00:00.000Z" });
  expect(calendar("America/New_York", "2026-03-08T12:00:00Z").range).toEqual({ from: "2026-03-08T05:00:00.000Z", to: "2026-03-09T04:00:00.000Z" });
  expect(calendar("America/New_York", "2026-11-01T12:00:00Z").range).toEqual({ from: "2026-11-01T04:00:00.000Z", to: "2026-11-02T05:00:00.000Z" });
  expect(calendar("America/New_York", "2026-03-08T12:00:00Z", "2026-03-08T02:30").rejected).toBe(true);
  expect(calendar("America/New_York", "2026-03-08T12:00:00Z", "2026-03-08T02:30").error).toBe("TaskValidationError");
  expect(calendar("America/New_York", "2026-11-01T12:00:00Z", "2026-11-01T01:30").converted).toBe("2026-11-01T05:30:00.000Z");
});
it("retains exact milliseconds, clears dates, rejects calendar overflow and missing time", () => {
  const utc = "2026-10-04T11:12:13.456Z";
  expect(fromLocalInput(toLocalInput(utc))).toBe(utc);
  expect(fromLocalInput("")).toBeNull(); expect(toLocalInput(null)).toBe("");
  expect(() => fromLocalInput("2026-02-30T12:00")).toThrow();
  expect(() => fromLocalInput("2026-10-04")).toThrow();
});
