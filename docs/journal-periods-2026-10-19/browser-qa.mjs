import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'file:///C:/Users/Heart/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const output='docs/journal-periods-2026-10-19/';
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Shanghai',acceptDownloads:true});
await context.addInitScript(()=>{
  const key='todoa.journal.v1'; if(localStorage.getItem(key))return;
  const day=(start,text,extra={})=>({kind:'day',start,end:start,title:'',text,theme:'',important:false,items:[],revision:1,createdAt:start+'T01:00:00.000Z',updatedAt:start+'T01:00:00.000Z',deletedAt:null,...extra});
  const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'上周日客户反馈：开户资料已补齐。',marks:[{type:'bold'}]}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'下次核对结算账户服务情况'}]}]}]},{type:'paragraph',content:[{type:'text',text:'沟通材料链接',marks:[{type:'link',attrs:{href:'https://example.com/'}}]}]}]};
  localStorage.setItem(key,JSON.stringify([
    day('2026-10-18','上周日客户反馈：开户资料已补齐。',{contentJson:JSON.stringify(doc),contentRevision:1,items:[{id:'legacy-task-18',title:'乙公司 · 核对开户资料',notes:'已核对法人及经办人材料',taskId:88,taskCreatedAt:'2026-10-18T01:00:00.000Z',completedAt:'2026-10-18T02:00:00.000Z',theme:'',important:false}]}),
    day('2026-10-01','月初记录：跟进甲公司结算资金归集。'),
    day('2026-09-30','九月记录：客户季度回访。'),
    day('2025-12-31','去年记录：年度客户回访。'),
    day('2026-10-17','已删除内容不能显示。',{deletedAt:'2026-10-18T01:00:00.000Z'}),
    {...day('2026-10-01','历史月总结应单独保留。'),kind:'month',end:'2026-10-31'},
  ]));
});
const page=await context.newPage(), errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const scopes=()=>page.getByRole('group',{name:'日记显示范围'});
const entries=()=>page.locator('.daily-range-entry');
const note=()=>page.getByRole('textbox',{name:'日记补充内容'});
async function scope(name){await scopes().getByRole('button',{name,exact:true}).click();await scopes().getByRole('button',{name,exact:true,pressed:true}).waitFor();}
async function count(value){await page.waitForFunction(expected=>document.querySelectorAll('.daily-range-entry').length===expected,value);}
try {
  await page.clock.setFixedTime(new Date('2026-10-19T10:00:00+08:00'));
  await page.goto(process.env.TODOA_QA_URL??'http://127.0.0.1:1424/',{waitUntil:'networkidle'});
  await page.getByLabel('新任务',{exact:true}).fill('甲公司 · 提交授信材料');await page.getByRole('button',{name:'添加任务',exact:true}).click();
  await page.getByRole('checkbox',{name:'完成：甲公司 · 提交授信材料',exact:true}).click();
  await page.getByRole('button',{name:'日记',exact:true}).click();await note().waitFor();
  await note().fill('周一拜访甲公司，已沟通授信补充材料。');
  await note().press('Control+a');await note().press('Control+b');await page.keyboard.insertText('本周重点：跟进客户补充资料。');await note().press('Control+b');
  await page.getByLabel('选择日记图片').setInputFiles('docs/simple-journal-2026-10-18/image-fixture.png');await page.locator('.daily-note img').waitFor();
  await page.getByRole('status').filter({hasText:/^已保存$/}).waitFor();
  await scope('周');await count(1);
  assert((await page.locator('.daily-datebar').innerText()).includes('2026-10-19 — 2026-10-25'));
  assert((await entries().innerText()).includes('甲公司 · 提交授信材料'));assert.equal(await note().count(),0);
  await entries().locator('img').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.daily-range-entry img')?.naturalWidth>0);
  assert.equal(await entries().locator('strong').count(),1);
  pass('Week shows saved daily tasks, formatted notes and local images, without creating a period summary');
  await scope('月');await count(3);
  const monthly=await page.locator('.daily-range').innerText();
  assert(monthly.includes('月初记录')&&monthly.includes('上周日客户反馈')&&monthly.includes('本周重点'));
  assert(!monthly.includes('九月记录')&&!monthly.includes('已删除内容')&&!monthly.includes('历史月总结'));
  assert.equal(await page.locator('.daily-range-note a[href="https://example.com/"]').count(),1);
  assert.equal(await page.locator('.daily-range-note ul li').count(),1);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:output+'month-wide.png',fullPage:true});
  pass('Month lists journals newest first, preserves lists and links, and excludes trash and legacy summaries');
  await page.getByRole('button',{name:'上个月',exact:true}).click();await count(1);assert((await entries().innerText()).includes('九月记录'));
  await page.getByRole('button',{name:'下个月',exact:true}).click();await count(3);
  pass('Previous and next month move the time window correctly');
  await scope('年');await count(4);assert((await page.locator('.daily-range').innerText()).includes('九月记录'));assert(!(await page.locator('.daily-range').innerText()).includes('去年记录'));
  await page.getByRole('button',{name:'上一年',exact:true}).click();await count(1);assert((await entries().innerText()).includes('去年记录'));
  await page.getByRole('button',{name:'今年',exact:true}).click();await count(4);
  pass('Year includes all current-year daily journals and supports previous year and return to this year');
  await page.getByRole('button',{name:'打开2026-10-18日记',exact:true}).click();await note().waitFor();assert((await note().innerText()).includes('上周日客户反馈'));
  await note().locator('p').last().click();await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.insertText('电话确认已完成。');
  await scope('月');await count(3);assert((await page.getByRole('article',{name:'2026-10-18日记',exact:true}).innerText()).includes('电话确认已完成。'));
  pass('Opening a dated journal returns to the editor and switching back to a period saves the last input');
  const calendar=page.getByRole('region',{name:'日记月历'});
  await calendar.getByRole('button',{name:'日历上个月'}).click();await calendar.getByRole('button',{name:'查看2026-09-30日记',exact:true}).click();await count(1);
  assert((await page.locator('.daily-datebar').innerText()).includes('2026-09-01 — 2026-09-30'));
  await calendar.getByRole('button',{name:'日历回到今天'}).click();await count(3);
  pass('Calendar date selection keeps the chosen scope and updates the natural period');
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'日记更多操作'}).click();
  assert(await page.getByRole('button',{name:'移入回收站',exact:true}).isDisabled());
  await page.getByRole('button',{name:'导出 Markdown'}).click();const download=await downloadEvent;await download.saveAs(output+'month-export.md');
  const markdown=await readFile(output+'month-export.md','utf8');assert(markdown.includes('2026-10-01')&&markdown.includes('2026-10-18')&&markdown.includes('2026-10-19')&&markdown.includes('data:image/png;base64,')&&!markdown.includes('九月记录')&&!markdown.includes('已删除内容')&&!markdown.includes('历史月总结'));
  pass('Period export includes only the displayed daily journals and images, and offers no bulk trash action');
  await page.reload();await page.getByRole('button',{name:'日记',exact:true}).click();await scope('年');await count(4);
  await page.setViewportSize({width:390,height:844});await scopes().scrollIntoViewIfNeeded();
  const rect=await scopes().boundingBox();assert(rect.x>=0&&rect.x+rect.width<=390);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await entries().first().scrollIntoViewIfNeeded();await page.locator('.daily-range-entry img').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.daily-range-entry img')?.naturalWidth>0);
  await page.screenshot({path:output+'year-narrow.png',fullPage:true});
  pass('390px scope controls and yearly journals have no horizontal overflow');
  assert.deepEqual(errors,[]);await writeFile(output+'checks.json',JSON.stringify({checks,errors},null,2));
} catch(error){console.error(error,errors);await page.screenshot({path:output+'failure.png',fullPage:true});throw error;}
finally{await browser.close();}
