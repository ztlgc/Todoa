import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

const sources = Object.fromEntries(["taskDates", "task", "list", "tag", "recurrence", "naturalTaskInput"].map(name => [name,
  ts.transpileModule(readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
]));

function inTimezone(zone: string, expression: string): unknown {
  const script = `const sources=${JSON.stringify(sources)},cache={};function load(name){name=name.replace("./","");if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;new Function("require","module","exports",sources[name])(load,module,module.exports);return module.exports;}const {nextRepeatDue,parseNaturalTaskInput}=load("naturalTaskInput");const {defaultRecurrence,nextRecurrenceDue}=load("recurrence");const {fromLocalInput}=load("taskDates");console.log(JSON.stringify(${expression}));`;
  return JSON.parse(execFileSync(process.execPath, [], { input: script, env: { ...process.env, TZ: zone }, encoding: "utf8" }));
}

it.each([
  ["America/New_York", "2026-03-07T02:30:00", "2026-03-08T07:30:00.000Z"],
  ["America/New_York", "2026-10-31T01:30:00", "2026-11-01T05:30:00.000Z"],
  ["Australia/Lord_Howe", "2026-10-03T02:15:00", "2026-10-03T15:45:00.000Z"],
  ["Pacific/Apia", "2011-12-29T12:00:00", "2011-12-30T22:00:00.000Z"],
])("resolves recurrence transitions consistently in %s / %s", (zone, prior, expected) => {
  expect(inTimezone(zone, `nextRepeatDue(new Date(${JSON.stringify(prior)}).toISOString(),"day:1",new Date(${JSON.stringify(prior)}))`)).toBe(expected);
});

it.each(["Asia/Shanghai", "UTC", "America/New_York", "Australia/Lord_Howe", "Pacific/Apia"])("preserves local deadlines across year and leap boundaries in %s", zone => {
  expect(inTimezone(zone, `(()=>{const prior=new Date("2024-02-29T09:15:00");const due=nextRepeatDue(prior.toISOString(),"year:1",prior);const local=new Date(due);return [local.getFullYear(),local.getMonth()+1,local.getDate(),local.getHours(),local.getMinutes()]})()`)).toEqual([2025, 2, 28, 9, 15]);
});

it.each([
  ["America/New_York", "2026-03-07T09:00:00", "明天02:30开会"],
  ["Australia/Lord_Howe", "2026-10-03T09:00:00", "明天02:15开会"],
])("keeps nonexistent explicitly requested local times as text in %s", (zone, now, input) => {
  expect(inTimezone(zone, `parseNaturalTaskInput(${JSON.stringify(input)},new Date(${JSON.stringify(now)}))`)).toMatchObject({ title: input, dueAt: null, reminderOffsets: [] });
});

it.each(["day:1", "month-last"])("stops %s when local time would exceed the supported UTC year", rule => {
  expect(inTimezone("America/New_York", `(()=>{const prior=new Date("9999-12-30T23:30:00");return nextRepeatDue(prior.toISOString(),${JSON.stringify(rule)},prior)})()`)).toBeNull();
});
