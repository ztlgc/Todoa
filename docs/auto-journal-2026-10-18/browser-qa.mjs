import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const bundled = process.env.TODOA_QA_NODE_MODULES;
if (!bundled) throw new Error("Set TODOA_QA_NODE_MODULES to the bundled node_modules directory.");
const { chromium } = await import(pathToFileURL(path.join(bundled,"playwright/index.mjs")).href);
const output = path.dirname(fileURLToPath(import.meta.url));
await mkdir(output,{ recursive:true });
const browser = await chromium.launch({ channel:"msedge",headless:true });
const context = await browser.newContext({ viewport:{ width:1280,height:1000 },timezoneId:"Asia/Shanghai",acceptDownloads:true });
const page = await context.newPage();
const errors = [];
page.on("pageerror",error => errors.push(error.message));
const checks = [];
const base = process.env.TODOA_QA_URL ?? "http://127.0.0.1:1424";
const a = "甲公司 · 提交授信材料", b = "乙公司 · 核对开户资料";
const manual = "已提交材料，等待内部审批反馈；明日跟进客户补充说明。";
const today = "2026-10-18";
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
async function openJournal() { await page.getByRole("button",{ name:"日记",exact:true }).click(); await page.getByRole("heading",{ name:"客户跟进与工作记录" }).waitFor(); }
async function createAndComplete(title) {
  await page.getByRole("button",{ name:"任务",exact:true }).click();
  await page.getByLabel("新任务",{ exact:true }).fill(title);
  await page.getByRole("button",{ name:"添加任务",exact:true }).click();
  await page.getByRole("checkbox",{ name:`完成：${title}`,exact:true }).click();
  await page.getByRole("checkbox",{ name:`完成：${title}`,exact:true }).waitFor({ state:"hidden" });
}
async function editDay() { await page.getByRole("button",{ name:`编辑${today}日记`,exact:true }).click(); return page.getByRole("dialog").filter({ has:page.getByLabel("总结正文",{ exact:true }) }); }
try {
  await page.clock.install({ time:new Date("2026-10-18T10:00:00+08:00") });
  await page.goto(base,{ waitUntil:"networkidle",timeout:60000 });
  await createAndComplete(a);
  await openJournal();
  await page.getByRole("heading",{ name:a,exact:true }).waitFor();
  assert.equal(await page.locator(".jp-auto-item").count(),1);
  check("Completing a real task immediately creates the daily journal");

  let editor = await editDay();
  assert.equal(await editor.getByLabel("工作条目1标题").count(),0);
  await editor.getByLabel("总结正文",{ exact:true }).fill(manual);
  await editor.getByRole("button",{ name:"收起日记编辑",exact:true }).click();
  await page.getByRole("button",{ name:"关闭编辑",exact:true }).click();
  await createAndComplete(b);
  await openJournal();
  editor = await editDay();
  await editor.getByRole("button",{ name:"恢复草稿",exact:true }).click();
  assert.equal(await editor.getByLabel("总结正文",{ exact:true }).inputValue(),manual);
  assert.equal(await editor.locator(".jp-auto-item").count(),2);
  await editor.getByRole("button",{ name:"保存日记",exact:true }).click();
  await editor.getByText("已保存到本地。",{ exact:true }).waitFor();
  await editor.getByRole("button",{ name:"收起日记编辑",exact:true }).click();
  check("Recovered handwritten draft saves alongside newly captured tasks");

  await page.getByLabel("搜索全部工作记录",{ exact:true }).fill("乙公司");
  await page.waitForFunction(() => document.querySelectorAll(".jp-auto-item").length===1);
  await page.getByRole("button",{ name:"清除搜索",exact:true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".jp-auto-item").length===2);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button",{ name:"导出当前工作回顾",exact:true }).click();
  const download = await downloadEvent;
  const downloadPath = path.join(output,"daily-journal.md"); await download.saveAs(downloadPath);
  const { readFile } = await import("node:fs/promises");
  const exported = await readFile(downloadPath,"utf8");
  assert(exported.includes(a) && exported.includes(b) && exported.includes(manual) && exported.includes("自动记录"));
  check("Search and actual Markdown download include automatic snapshots and manual summary");
  await page.screenshot({ path:path.join(output,"automatic-daily-journal-wide.png"),fullPage:true });

  const aCard = page.locator(".jp-auto-item").filter({ has:page.getByRole("heading",{ name:a,exact:true }) });
  await aCard.getByRole("button",{ name:"查看原任务",exact:true }).click();
  const source = page.getByRole("dialog");
  await source.getByRole("button",{ name:"恢复为待跟进",exact:true }).click();
  await source.getByRole("button",{ name:"关闭",exact:true }).click();
  assert.equal(await page.locator(".jp-auto-item").count(),1);
  assert(await page.getByText(manual,{ exact:true }).isVisible());
  check("Undoing a same-day completion withdraws only its automatic entry");

  await page.getByRole("button",{ name:"任务",exact:true }).click();
  await page.getByRole("checkbox",{ name:`完成：${a}`,exact:true }).click();
  await page.getByRole("checkbox",{ name:`完成：${a}`,exact:true }).waitFor({ state:"hidden" });
  await openJournal();
  await page.waitForFunction(() => document.querySelectorAll(".jp-auto-item").length===2);
  editor = await editDay();
  await editor.getByRole("button",{ name:"删除日记",exact:true }).click();
  await page.getByRole("button",{ name:"删除记录",exact:true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".jp-auto-item").length===0);
  await page.reload({ waitUntil:"networkidle" });
  await openJournal();
  assert.equal(await page.locator(".jp-auto-item").count(),0);
  await page.getByRole("button",{ name:"日记回收站",exact:true }).click();
  await page.getByRole("button",{ name:"恢复",exact:true }).click();
  await page.getByRole("button",{ name:"日记回收站",exact:true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".jp-auto-item").length===2);
  assert(await page.getByText(manual,{ exact:true }).isVisible());
  check("Deleted day stays deleted after reload and restores all snapshots and manual text");

  await page.reload({ waitUntil:"networkidle" }); await openJournal();
  assert.equal(await page.locator(".jp-auto-item").count(),2);
  check("Reload preserves snapshots without duplicates after temporary browser tasks reset");
  await page.setViewportSize({ width:390,height:844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({ path:path.join(output,"automatic-daily-journal-narrow.png"),fullPage:true });
  editor = await editDay();
  assert.equal(await editor.locator(".jp-auto-item").count(),2);
  assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({ path:path.join(output,"automatic-daily-journal-editor.png"),fullPage:true });
  check("390px timeline and editor have no horizontal overflow");

  const sample = await browser.newContext({ viewport:{ width:1280,height:1000 },timezoneId:"Asia/Shanghai" });
  const fixture = await sample.newPage();
  await fixture.goto(`${base}/bank-journal-test.html`,{ waitUntil:"networkidle",timeout:60000 });
  await fixture.getByRole("button",{ name:"日记",exact:true }).click();
  await fixture.locator(".jp-auto-item").first().waitFor();
  const firstCount = await fixture.locator(".jp-auto-item").count();
  await fixture.reload({ waitUntil:"networkidle" });
  await fixture.getByRole("button",{ name:"日记",exact:true }).click();
  assert.equal(await fixture.locator(".jp-auto-item").count(),firstCount);
  assert.equal(await fixture.evaluate(() => localStorage.getItem("todoa.journal.v1")),null);
  await fixture.screenshot({ path:path.join(output,"bank-automatic-journal.png"),fullPage:true });
  await sample.close();
  check("Bank fixture remains isolated and does not duplicate its automatic sample on reload");
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,"browser-results.json"),JSON.stringify({ checks,errors },null,2));
} catch (error) {
  await page.screenshot({ path:path.join(output,"browser-failure.png"),fullPage:true }).catch(() => {});
  await writeFile(path.join(output,"browser-failure.txt"),`${error.stack}\n\n${await page.locator("body").innerText().catch(() => "")}`);
  throw error;
} finally { await context.close(); await browser.close(); }
