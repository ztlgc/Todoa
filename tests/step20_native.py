"""STEP20 actual WebView2/SQLite UI, isolated DB; browser clock/TZ emulation explicitly labelled."""
import sys
sys.dont_write_bytecode=True
import argparse,ctypes,json,os,sqlite3,time
from pathlib import Path
from datetime import datetime,timedelta,timezone
from contextlib import closing
from native_support import Harness,HIDDEN,wait,app_pids,user32,native_windows,wintypes,ELEMENT
from step15_native import owned_windows
from step18_native import child_windows
ROOT=Path(__file__).resolve().parents[1];ID='com.todoa.desktop.test.step20';DB=Path(os.environ['APPDATA'])/ID/'todo.db'
user32.SetWindowPos.argtypes=[wintypes.HWND,wintypes.HWND,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,wintypes.UINT]

def main():
    p=argparse.ArgumentParser();p.add_argument('--native-driver',type=Path,required=True);p.add_argument('--clean-known-fixture',action='store_true');args=p.parse_args()
    assert not app_pids()
    if DB.exists():
        assert args.clean_known_fixture,'Existing isolated fixture must be acknowledged'
        with closing(sqlite3.connect(f'file:{DB.as_posix()}?mode=ro',uri=True))as d:
            assert d.execute('PRAGMA application_id').fetchone()[0]==0x57544431
            assert all(r[0].startswith('S20 ')for r in d.execute('SELECT title FROM tasks'))
            assert all(r[0].startswith('S20 ')for r in d.execute('SELECT name FROM lists'))
            assert all(r[0].startswith('S20 ')for r in d.execute('SELECT name FROM tags'))
    evidence=ROOT/'docs/evidence'/('step20-'+datetime.now().strftime('%Y%m%d-%H%M%S'));evidence.mkdir()
    fixtures=ROOT/'.local-test-data'/evidence.name;fixtures.mkdir(parents=True)
    h=Harness(ROOT/'src-tauri/target/debug/todoa.exe',ID,args.native_driver,evidence)
    report={'identifier':ID,'checks':[],'emulation':'Renderer Date and CDP timezone only, not OS clock/login or real IME keystrokes','physical_ime':'Validated separately by step20_ime_native.py; consult its report'}
    def sql(query,values=[],write=False):
        r=h.invoke('plugin:sql|'+('execute'if write else'select'),{'db':'sqlite:todo.db','query':query,'values':values});assert 'value'in r,r
        value=r['value']
        if write:
            assert isinstance(value,list)and len(value)==2,value
            return {'rowsAffected':value[0],'lastInsertId':value[1]}
        return value
    def nav(name):h.session.click(f'button[aria-label="打开{name}"]');h.session.script("document.dispatchEvent(new Event('visibilitychange'))");wait(lambda:h.session.script('return document.querySelector("h1")?.textContent')==name)
    def field(selector,text,native=False):
        if native:
            elem=h.session.element(selector);h.session.call('POST',f'/element/{elem}/clear',{});h.session.call('POST',f'/element/{elem}/value',{'text':text})
        else:
            h.session.script("const e=document.querySelector(arguments[0]);Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,arguments[1]);e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));",selector,text)
    def keys(selector,text):h.session.call('POST',f'/element/{h.session.element(selector)}/value',{'text':text})
    def edit(id):h.session.click(f'li[data-task-id="{id}"] button[aria-label^="编辑任务："]');wait(lambda:h.session.elements('#edit-task-title'));wait(lambda:h.session.script('return document.activeElement.id')=='edit-task-title')
    def close():h.button('关闭');wait(lambda:not h.session.elements('[role="dialog"]'))
    def clock(instant,tz):
        h.session.call('POST','/ms/cdp/execute',{'cmd':'Emulation.setTimezoneOverride','params':{'timezoneId':tz}})
        h.session.script("window.__realDate??=Date;window.__testInstant=window.__realDate.parse(arguments[0]);window.Date=class extends window.__realDate{constructor(...a){super(...(a.length?a:[window.__testInstant]));}static now(){return window.__testInstant}};window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));",instant)
        report.setdefault('calendar_contexts',[]).append({'instant':instant,'timezone':tz})
    def visible():return h.session.script('return [...document.querySelectorAll("li[data-task-id]")].map(e=>Number(e.dataset.taskId))')
    def record(name,shot=False):
        report['checks'].append({'name':name,'status':'PASS','visible':visible(),'ui':h.session.text()})
        if shot:report['checks'][-1]['screenshot']=h.session.screenshot(name)
        print('PASS '+name,flush=True)
    def file_dialog(path):
        def filename(c):return c['class']=='Edit'and(c['id']==1148 or c['parent_class']in ['ComboBox','ComboBoxEx32'])
        hwnd=wait(lambda:next((w for w in owned_windows(h.session.pid,'#32770')if user32.IsWindowVisible(w)and any(filename(c)for c in child_windows(w))),None),25)
        field=next(c for c in child_windows(hwnd)if filename(c));value=ctypes.create_unicode_buffer(str(path))
        user32.SendMessageW(field['hwnd'],0x000C,0,ctypes.cast(value,ctypes.c_void_p).value);user32.SendMessageW(field['hwnd'],0x00B1,len(str(path)),len(str(path)));user32.SendMessageW(field['hwnd'],0x0102,8,0);user32.SendMessageW(field['hwnd'],0x0102,ord(str(path)[-1]),0)
        time.sleep(.2);buttons=[c for c in child_windows(hwnd)if c['class']=='Button'and c['id']==1];assert buttons;user32.PostMessageW(buttons[0]['hwnd'],0x00F5,0,0)
    try:
        h.start()
        if args.clean_known_fixture:
            for table in ['reminders','task_tags','tasks','tags','lists','settings']:sql(f'DELETE FROM {table}',write=True)
            h.session.script("window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));");wait(lambda:visible()==[])
        assert h.session.script('return document.querySelectorAll("nav[aria-label=主导航] button").length')==6
        for name in ['今天','即将到来','清单','标签','设置','收件箱']:nav(name)
        record('01-six-real-views-no-fake-navigation',True)
        field('#task-title','未保存输入',True);h.session.click('button[aria-label="打开今天"]');wait(lambda:'当前任务输入或清单名称尚未保存'in h.session.text());h.button('继续编辑');wait(lambda:not h.session.elements('[role="dialog"]'));assert h.session.script('return document.querySelector("#task-title").value')=='未保存输入'
        h.session.click('button[aria-label="打开今天"]');h.button('放弃输入并继续');wait(lambda:'今天为空'in h.session.text());nav('收件箱');assert h.session.script('return document.querySelector("#task-title").value')=='';record('02-navigation-keeps-or-explicitly-discards-draft')
        field('#task-title','S20 编辑任务',True);keys('#task-title','\ue007');wait(lambda:len(visible())==1);taskid=visible()[0]
        nav('清单');field('#new-list-name','S20 工作',True);h.button('创建清单');wait(lambda:h.session.script('return document.querySelector("h1").textContent')=='S20 工作');listid=sql('SELECT id FROM lists WHERE name=?',['S20 工作'])[0]['id']
        nav('收件箱');edit(taskid);assert h.session.script('return document.activeElement.id')=='edit-task-title';keys('#edit-task-title','\ue004');assert h.session.script('return document.activeElement.id')=='edit-task-notes'
        for _ in range(16):
            active=h.session.call('GET','/element/active')[ELEMENT];h.session.call('POST',f'/element/{active}/value',{'text':'\ue004'});wait(lambda:h.session.script('return !!document.activeElement.closest("[role=dialog]")'))
        field('#edit-task-title','S20 已编辑中文',True);field('#edit-task-notes','多行纯文本\n第二行',True);field('#edit-task-due','2026-10-05T10:30:13.123');field('#edit-task-list',str(listid))
        h.session.script("document.querySelector('#edit-task-title').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.querySelector('form[aria-label=编辑任务]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));");assert sql('SELECT title FROM tasks WHERE id=?',[taskid])[0]['title']=='S20 编辑任务'
        h.session.script("document.querySelector('#edit-task-title').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));")
        h.button('关闭');wait(lambda:'放弃未保存的修改？'in h.session.text());active=h.session.call('GET','/element/active')[ELEMENT];h.session.call('POST',f'/element/{active}/value',{'text':'\ue00c'});wait(lambda:len(h.session.elements('[role="dialog"]'))==1);h.button('关闭');h.button('继续编辑');wait(lambda:len(h.session.elements('[role="dialog"]'))==1);assert h.session.script('return document.querySelector("#edit-task-notes").value')=='多行纯文本\n第二行'
        h.button('保存任务');wait(lambda:not h.session.elements('[role="dialog"]'));row=sql('SELECT * FROM tasks WHERE id=?',[taskid])[0];assert row['title']=='S20 已编辑中文'and row['notes']=='多行纯文本\n第二行'and row['list_id']==listid and row['due_at']=='2026-10-05T02:30:13.123Z',row
        assert visible()==[];wait(lambda:h.session.script('return document.activeElement.id')=='inbox-heading');record('03-native-enter-edit-ime-guard-atomic-fields-and-membership')
        nav('清单');h.session.click('button[aria-label="打开清单：S20 工作"]');wait(lambda:visible()==[taskid]);h.quit();h.start();nav('清单');h.session.click('button[aria-label="打开清单：S20 工作"]');wait(lambda:visible()==[taskid]);edit(taskid);assert h.session.script('return document.querySelector("#edit-task-notes").value')=='多行纯文本\n第二行';h.button('清空截止时间');h.button('保存任务');wait(lambda:not h.session.elements('[role="dialog"]'));assert sql('SELECT due_at FROM tasks WHERE id=?',[taskid])[0]['due_at']is None;h.quit();h.start();assert sql('SELECT due_at FROM tasks WHERE id=?',[taskid])[0]['due_at']is None;record('04-edit-and-clear-deadline-persist-across-normal-restart')
        nav('标签');field('#new-tag-name','S20 标签',True);h.button('创建标签');wait(lambda:bool(sql('SELECT id FROM tags')));tagid=sql('SELECT id FROM tags')[0]['id'];nav('清单');h.session.click('button[aria-label="打开清单：S20 工作"]');wait(lambda:visible()==[taskid]);edit(taskid);field(f'#task-tag-{taskid}',str(tagid));h.button('添加标签');wait(lambda:len(sql('SELECT * FROM task_tags'))==1)
        h.button('提醒');wait(lambda:h.session.elements(f'#remind-{taskid}'));future=datetime.now()+timedelta(days=2);field(f'#remind-{taskid}',future.strftime('%Y-%m-%dT%H:%M'));h.button('保存提醒');wait(lambda:len(sql('SELECT * FROM reminders'))==1);close();nav('标签');h.session.click('button[aria-label="打开标签：S20 标签"]');wait(lambda:visible()==[taskid]);record('05-real-details-tags-reminders-and-cross-list-tag-view',True)
        # SQL is the actual Main plugin, after Harness verified the isolated DB path.
        dates=[('before','2026-10-04T15:59:59.999Z','todo'),('start','2026-10-04T16:00:00.000Z','todo'),('last','2026-10-05T15:59:59.999Z','todo'),('next','2026-10-05T16:00:00.000Z','todo'),('later','2026-10-06T16:00:00.000Z','todo'),('done','2026-10-04T18:00:00.000Z','completed'),('none',None,'todo')]
        ids={};stamp='2026-10-04T00:00:00.000Z'
        for name,due,status in dates:
            r=sql('INSERT INTO tasks(title,status,due_at,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?)',['S20 '+name,status,due,stamp if status=='completed'else None,stamp,stamp],True);ids[name]=r['lastInsertId']
        clock('2026-10-04T18:00:00Z','Asia/Shanghai');nav('今天');wait(lambda:visible()==[ids['start'],ids['last']]);assert '逾期'in h.session.text();record('06-today-local-utc-half-open-null-completed-overdue',True)
        nav('即将到来');wait(lambda:visible()==[ids['next'],ids['later']]);record('07-upcoming-local-tomorrow-sorted')
        nav('今天');clock('2026-10-05T15:59:59.900Z','Asia/Shanghai');wait(lambda:visible()==[ids['start'],ids['last']]);clock('2026-10-05T16:00:00Z','Asia/Shanghai');wait(lambda:visible()==[ids['next']]);record('08-midnight-query-boundary-recomputed-without-restart')
        clock('2026-10-04T18:00:00Z','America/New_York');wait(lambda:visible()==[ids['before'],ids['start']]);assert sql('SELECT due_at FROM tasks WHERE id=?',[ids['start']])[0]['due_at']=='2026-10-04T16:00:00.000Z';record('09-renderer-timezone-query-changes-stored-utc-unchanged')
        # A DST gap and 23-hour day use actual browser timezone/calendar and real SQL.
        for label,utc in [('dst-start','2026-03-08T05:00:00.000Z'),('dst-last','2026-03-09T03:59:59.999Z'),('dst-next','2026-03-09T04:00:00.000Z')]:ids[label]=sql('INSERT INTO tasks(title,due_at,created_at,updated_at) VALUES(?,?,?,?)',['S20 '+label,utc,stamp,stamp],True)['lastInsertId']
        clock('2026-03-08T12:00:00Z','America/New_York');wait(lambda:visible()==[ids['dst-start'],ids['dst-last']]);edit(ids['dst-start']);field('#edit-task-due','2026-03-08T02:30');h.button('保存任务');wait(lambda:'本地日期不存在'in h.session.text());assert sql('SELECT due_at FROM tasks WHERE id=?',[ids['dst-start']])[0]['due_at']=='2026-03-08T05:00:00.000Z';h.button('关闭');h.button('放弃修改并关闭');wait(lambda:not h.session.elements('[role="dialog"]'));record('10-dst-23-hour-real-query-nonexistent-local-time-rejected')
        clock('2026-10-04T18:00:00Z','Asia/Shanghai');wait(lambda:visible()==[ids['start'],ids['last']]);edit(ids['start']);field('#edit-task-title','S20 时区草稿',True);clock('2026-10-04T18:00:00Z','America/New_York');wait(lambda:'系统时区已改变'in h.session.text());h.button('保存任务');assert sql('SELECT title FROM tasks WHERE id=?',[ids['start']])[0]['title']=='S20 start';h.button('采用当前时区');h.button('保存任务');wait(lambda:not h.session.elements('[role="dialog"]'));assert sql('SELECT due_at FROM tasks WHERE id=?',[ids['start']])[0]['due_at']=='2026-10-04T16:00:00.000Z';record('11-open-editor-timezone-change-needs-explicit-adoption')
        # Actual WebDriver Space controls the focused checkbox, not a programmatic click.
        checkbox=f'li[data-task-id="{ids["before"]}"] [role="checkbox"]';h.session.click(checkbox);wait(lambda:ids['before']not in visible());nav('收件箱');wait(lambda:ids['before']in visible());h.session.script('document.querySelector(arguments[0]).focus()',checkbox);keys(checkbox,' ');wait(lambda:sql('SELECT status FROM tasks WHERE id=?',[ids['before']])[0]['status']=='todo');record('12-keyboard-checkbox-completion-and-undo')
        # Long text, physical small window, larger font; no horizontal clipping.
        long='S20 '+('长标题' * 100);sql('UPDATE tasks SET title=? WHERE id=?',[long,ids['none']],True);h.session.script("window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));document.documentElement.style.fontSize='20px';")
        hwnd=h.main_window()['hwnd'];user32.SetWindowPos(hwnd,None,100,100,700,650,0x14);wait(lambda:long in h.session.text());assert h.session.script('return document.documentElement.scrollWidth<=document.documentElement.clientWidth+1');edit(ids['none']);assert h.session.script('const d=document.querySelector("[role=dialog]").getBoundingClientRect();return d.width<=innerWidth&&d.height<=innerHeight');record('13-small-window-large-font-long-title-dialog-scroll',True)
        h.session.script('document.querySelector("form[aria-label=编辑任务] button[type=submit]").scrollIntoView({block:"center"})');assert h.session.script('const b=document.querySelector("form[aria-label=编辑任务] button[type=submit]").getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight');report['large_font_save_reachable']=True;h.button('保存任务');wait(lambda:not h.session.elements('[role="dialog"]'))
        h.session.script("document.documentElement.style.fontSize='';window.Date=window.__realDate;window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));");h.session.call('POST','/ms/cdp/execute',{'cmd':'Emulation.setTimezoneOverride','params':{'timezoneId':''}})
        # Backup/restore uses real Rust file dialogs and a new process, rebuilding date Query and Scheduler.
        nav('设置');snapshot=fixtures/'ui-backup.db';h.button('备份数据');file_dialog(snapshot);wait(lambda:'备份已保存'in h.session.text());assert snapshot.exists()
        corrupt=fixtures/'corrupt.db';corrupt.write_bytes(b'not a SQLite backup');oldpid=h.session.pid;h.button('恢复备份');h.button('确认替换并选择备份');file_dialog(corrupt);wait(lambda:h.session.script('return document.querySelector("[role=alertdialog]")?.textContent.includes("恢复失败：")'));assert oldpid in app_pids();active=h.session.call('GET','/element/active')[ELEMENT];h.session.call('POST',f'/element/{active}/value',{'text':'\ue00c'});wait(lambda:not h.session.elements('[role="alertdialog"]'));record('14-corrupt-restore-error-visible-in-modal-escape-cancels')
        sql('UPDATE tasks SET title=? WHERE id=?',['S20 恢复前临时内容',ids['start']],True);pid=h.session.pid;h.button('恢复备份');h.button('确认替换并选择备份');file_dialog(snapshot);wait(lambda:pid not in app_pids(),25);newpid=wait(lambda:next(iter(app_pids()),None),25);h.attach(newpid);clock('2026-10-04T18:00:00Z','Asia/Shanghai');nav('今天');wait(lambda:visible()==[ids['start'],ids['last']]);assert 'S20 时区草稿'in h.session.text()and'恢复前临时内容'not in h.session.text();assert h.invoke('reminder_scheduler_status')['value']in ['ready','notification-setting-unknown'];assert h.session.script('return document.documentElement.scrollWidth<=document.documentElement.clientWidth+1');record('15-real-restore-new-process-query-date-and-scheduler-rebuilt',True)
        h.invoke('show_quick_add')
        def quick():
            for handle in h.session.call('GET','/window/handles'):
                h.session.call('POST','/window',{'handle':handle})
                if h.session.script('return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label')=='quick-add':return True
            return False
        wait(quick);wait(lambda:h.session.elements('#quick-title'));keys('#quick-title','\ue00c');wait(lambda:all(not w['visible']for w in native_windows(h.session.pid)if w['title']=='Todoa · 快速添加'));h.session.call('POST','/window',{'handle':h.session.main_handle});record('16-quick-add-escape-hides-only-quick-main-retained');assert h.main_window()['visible']
        h.quit();report['normal_exit']=True;report['status']='PASS'
    except Exception as error:
        report['status']='FAIL';report['error']=repr(error)
        if h.session:
            try:report['body']=h.session.text();h.session.screenshot('failure')
            except Exception:pass
        raise
    finally:
        (evidence/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(evidence/'report.json',flush=True);h.close()
if __name__=='__main__':main()
