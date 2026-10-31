// Node 24; no dependencies. Usage: node native-cdp.mjs snapshot|eval <expression>|click <CSS>|text <exact button text>|type <CSS> <text>|shot <name>|reload
import fs from 'node:fs';
import path from 'node:path';
const port = Number(process.env.TODOA_TEST_CDP_PORT || 19331);
const expected = 'com.todoa.desktop.test.review20261031';
const out = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && !t.url.includes('quick-add') && (t.url.includes('tauri.localhost') || t.url.includes('tauri://')));
if (!target) throw new Error(`Main native target missing: ${JSON.stringify(targets)}`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0; const pending = new Map();
const events = [];
ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id) { const p = pending.get(msg.id); if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(Error(JSON.stringify(msg.error))) : p.resolve(msg.result); } } else if (msg.method === 'Runtime.exceptionThrown' || msg.method === 'Log.entryAdded') events.push(msg); };
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 20000); pending.set(id, {resolve, reject, timer}); ws.send(JSON.stringify({id, method, params})); }); }
async function evaluate(expression) { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
await send('Runtime.enable'); await send('Log.enable');
// Identifier introspection is intentionally not granted by the product capability.
// Verify the already-open native SQL pool's path without opening another database.
const databaseList = await evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {db:'sqlite:todo.db',query:'PRAGMA database_list',values:[]})`);
const databasePath = databaseList.find(row => row.name === 'main')?.file;
if (!databasePath || !databasePath.split(String.fromCharCode(92)).join('/').includes('/' + expected + '/')) { ws.close(); throw Error(`Refusing unexpected database path: ${databasePath}`); }
const identifier = expected;
async function click(selector) {
  const pos = await evaluate(`(() => {const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('Missing selector'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:!!e.disabled};})()`);
  if (pos.disabled) throw Error('Target disabled');
  await send('Input.dispatchMouseEvent', {type:'mousePressed', x:pos.x,y:pos.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent', {type:'mouseReleased', x:pos.x,y:pos.y,button:'left',clickCount:1});
}
const [cmd, arg, value] = process.argv.slice(2);
let result;
if (cmd === 'snapshot') result = await evaluate(`({url:location.href,title:document.title,native:!!window.__TAURI_INTERNALS__,text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(e=>({text:e.innerText,aria:e.getAttribute('aria-label'),disabled:e.disabled})),inputs:[...document.querySelectorAll('input,textarea,[contenteditable="true"]')].map(e=>({tag:e.tagName,label:e.getAttribute('aria-label'),placeholder:e.getAttribute('placeholder'),role:e.getAttribute('role'),value:e.value,text:e.innerText}))})`);
else if (cmd === 'scenario') {
 const steps = JSON.parse(fs.readFileSync(path.join(out,arg),'utf8'));
 const records=[];
 const reportFile=path.join(out,arg.replace(/\.json$/,'.results.json'));
 for (const step of steps) {
  try {
   if(step.click) await click(step.click);
   if(step.text) {
    const index=await evaluate(`(() => {const a=[...document.querySelectorAll('button')];const i=a.findIndex(e=>e.innerText.trim()===${JSON.stringify(step.text)});if(i<0)throw Error('Missing button text');return i;})()`);
    const pos=await evaluate(`(() => {const e=document.querySelectorAll('button')[${index}];e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:e.disabled};})()`);
    if(pos.disabled)throw Error('Button disabled');
    for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:pos.x,y:pos.y,button:'left',clickCount:1});
   }
   if(step.type) {await click(step.type);await send('Input.insertText',{text:step.value});}
   if(step.eval) records.push({step:step.name,value:await evaluate(step.eval)});
   if(step.reload)await send('Page.reload',{ignoreCache:true});
   if(step.wait) {
    const deadline=Date.now()+(step.timeout||12000);let matched=false;
    while(Date.now()<deadline){try{if(await evaluate(step.wait)){matched=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
    if(!matched)throw Error('Timed out waiting: '+step.wait);
   }
   if(step.shot){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,step.shot),Buffer.from(shot.data,'base64'));}
   records.push({name:step.name,passed:true,at:new Date().toISOString()});
  }catch(e){records.push({name:step.name,passed:false,error:String(e),at:new Date().toISOString()});fs.writeFileSync(reportFile,JSON.stringify({databasePath,records,events},null,2));throw e;}
  fs.writeFileSync(reportFile,JSON.stringify({databasePath,records,events},null,2));
 }
 result={databasePath,records};
}
else if (cmd === 'eval') result = await evaluate(arg);
else if (cmd === 'click') { await click(arg); result = {clicked:arg}; }
else if (cmd === 'text') {
 const selector = await evaluate(`(() => {const list=[...document.querySelectorAll('button')];const e=list.find(e=>e.innerText.trim()===${JSON.stringify(arg)});if(!e)throw Error('Missing button text');return 'button:nth-of-type(1)' && list.indexOf(e);})()`);
 const tag = `button[data-native-cdp-target]`;
 // Temporary locator only: no product state or rendered content is changed.
 await evaluate(`document.querySelectorAll('button')[${selector}].setAttribute('data-native-cdp-target','true')`);
 await click(tag);
 await evaluate(`document.querySelector('[data-native-cdp-target]')?.removeAttribute('data-native-cdp-target')`);
 result = {clickedText:arg};
} else if (cmd === 'type') { await click(arg); await send('Input.insertText',{text:value}); result = {typedInto:arg,text:value}; }
else if (cmd === 'shot') { const shot = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); const file=path.join(out,arg.endsWith('.png')?arg:`${arg}.png`); fs.writeFileSync(file,Buffer.from(shot.data,'base64')); result={screenshot:file}; }
else if (cmd === 'reload') { await send('Page.reload',{ignoreCache:true}); result={reloaded:true}; }
else throw Error('Unknown command');
console.log(JSON.stringify({at:new Date().toISOString(),identifier,target:{id:target.id,url:target.url},result,events},null,2));
ws.close();
