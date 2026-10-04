"""Real Rust file dialogs + process restart, in a dedicated test identifier only.
Attach WebDriver to WebView2 so it can reconnect to a Rust-initiated new process.
"""
import sys
sys.dont_write_bytecode=True
import argparse, ctypes, json, os, socket, sqlite3, subprocess, time
from contextlib import closing
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.request import urlopen
from step8_native import NativeSession, HIDDEN, wait, app_pids, ELEMENT
from step12_native import native_windows, CALLBACK
from step15_native import user32, owned_windows, shell32, IconIdentifier, wintypes, ImageGrab

ROOT=Path(__file__).resolve().parents[1]
IDENTIFIER='com.todoa.desktop.test.step18'
DATABASE=Path(os.environ['APPDATA'])/IDENTIFIER/'todo.db'
user32.GetParent.argtypes=[wintypes.HWND];user32.GetParent.restype=wintypes.HWND

def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

def child_windows(hwnd):
    result=[]
    @CALLBACK
    def collect(child,_):
        cls=ctypes.create_unicode_buffer(128);text=ctypes.create_unicode_buffer(512)
        user32.GetClassNameW(child,cls,128);user32.GetWindowTextW(child,text,512)
        parent_cls=ctypes.create_unicode_buffer(128);user32.GetClassNameW(user32.GetParent(child),parent_cls,128)
        result.append({'hwnd':int(child),'class':cls.value,'text':text.value,'id':user32.GetDlgCtrlID(child),'parent_id':user32.GetDlgCtrlID(user32.GetParent(child)),'parent_class':parent_cls.value})
        return True
    user32.EnumChildWindows(hwnd,collect,0);return result

def main():
    p=argparse.ArgumentParser();p.add_argument('--native-driver',type=Path,required=True);p.add_argument('--clean-known-fixture',action='store_true');args=p.parse_args()
    assert not app_pids(),'Existing Todoa process; refusing native test'
    if DATABASE.exists():
        assert args.clean_known_fixture,'Refusing to reuse an existing test database without explicit fixture cleanup'
        with closing(sqlite3.connect(f'file:{DATABASE.as_posix()}?mode=ro',uri=True)) as db:
            assert db.execute('PRAGMA application_id').fetchone()[0]==0x57544431
            assert all(row[0]in ['Backup STEP18 fixture','Old cache must disappear'] for row in db.execute('SELECT title FROM tasks')),'Unknown task data'
            assert all(row[0]=='BackupList' for row in db.execute('SELECT name FROM lists')),'Unknown list data'
            assert all(row[0]=='BackupTag' for row in db.execute('SELECT name FROM tags')),'Unknown tag data'
            assert all(row[0]=='backup-test' for row in db.execute('SELECT key FROM settings')),'Unknown settings data'
    evidence=ROOT/'docs/evidence'/('step18-'+datetime.now().strftime('%Y%m%d-%H%M%S'));evidence.mkdir()
    fixtures=ROOT/'.local-test-data'/evidence.name;fixtures.mkdir(parents=True)
    report={'identifier':IDENTIFIER,'checks':[],'denials':[],'destructive_scope':str(fixtures),'process_restarts':[]}
    cdp=free_port();session=None;driver=None;app=None
    log=(evidence/'driver.txt').open('w',encoding='utf-8')
    def attach(pid,ready=True):
        nonlocal session,driver
        if driver:
            subprocess.run(['taskkill','/PID',str(driver.pid),'/T','/F'],creationflags=HIDDEN,capture_output=True);driver.wait();driver=None
        port=free_port()
        driver=subprocess.Popen([str(args.native_driver),'--port='+str(port)],stdout=log,stderr=log,creationflags=HIDDEN)
        def driver_ready():
            try:return json.load(urlopen(f'http://127.0.0.1:{port}/status',timeout=2))['value']['ready']
            except Exception:return False
        wait(driver_ready)
        session=NativeSession.__new__(NativeSession);session.base=f'http://127.0.0.1:{port}';session.session=None;session.pid=pid;session.evidence=evidence;session.identifier=IDENTIFIER
        result=session.request('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'webview2','ms:edgeOptions':{'debuggerAddress':f'localhost:{cdp}'}}}})
        session.session=result['sessionId']
        def select_main():
            for handle in session.call('GET','/window/handles'):
                session.call('POST','/window',{'handle':handle})
                if session.script('return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label')=='main':session.main_handle=handle;return True
            return False
        wait(select_main)
        if ready:
            session.ready()
            rows=invoke('plugin:sql|select',{'db':'sqlite:todo.db','query':'PRAGMA database_list','values':[]})['value']
            assert Path(next(r['file'] for r in rows if r['name']=='main')).resolve()==DATABASE.resolve(),'Refusing data writes outside isolated DB'
        else:
            wait(lambda:'SQL_PLUGIN_START_FAILED'in session.text())
            assert not session.elements('#task-title'),'No Query or mutation UI before Ready'
    def invoke(command,arguments=None):
        return session.call('POST','/execute/async',{'script':"const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({denial:String(error)}));",'args':[command,arguments or {}]})
    def button(text):
        el=wait(lambda:session.script("return [...document.querySelectorAll('button')].find(b=>b.textContent.trim()===arguments[0])",text));session.call('POST',f'/element/{el[ELEMENT]}/click',{})
    def begin_restore():button('恢复备份');button('确认替换并选择备份')
    def dialog(path=None,cancel=False):
        def filename(c):return c['class']=='Edit'and c['id']in (1001,1148)and c['parent_class']=='ComboBox'
        def loaded_dialog():
            for candidate in owned_windows(session.pid,'#32770'):
                if not user32.IsWindowVisible(candidate):continue
                controls=child_windows(candidate)
                if not any(c['class']=='Button'and c['id']==1 for c in controls):continue
                if cancel or any(filename(c)for c in controls):return candidate
            return None
        try:hwnd=wait(loaded_dialog,25)
        except Exception:
            report['last_dialog_scan']=[{'hwnd':h,'visible':bool(user32.IsWindowVisible(h)),'children':child_windows(h)}for h in owned_windows(session.pid,'#32770')]
            ImageGrab.grab().save(evidence/'desktop-dialog-failure.png')
            raise
        children=child_windows(hwnd);report.setdefault('dialogs',[]).append(children)
        if cancel:
            user32.PostMessageW(hwnd,0x0010,0,0);return
        try:edits=wait(lambda:[c for c in child_windows(hwnd) if filename(c)],20)
        except Exception:
            report['loaded_dialog_children']=child_windows(hwnd)
            rect=wintypes.RECT();user32.GetWindowRect(hwnd,ctypes.byref(rect))
            if rect.right>rect.left and rect.bottom>rect.top:ImageGrab.grab(bbox=(rect.left,rect.top,rect.right,rect.bottom)).save(evidence/'file-dialog-failure.png')
            raise
        assert edits,children
        # Modern IFileDialog filename field lives under ComboBox/ComboBoxEx32.
        field=edits[0];report.setdefault('filename_fields',[]).append(field)
        value=ctypes.create_unicode_buffer(str(path))
        user32.SendMessageW(field['hwnd'],0x000C,0,ctypes.cast(value,ctypes.c_void_p).value) # WM_SETTEXT on the filename edit, not the address bar.
        user32.SendMessageW(field['hwnd'],0x00B1,len(str(path)),len(str(path))) # EM_SETSEL
        user32.SendMessageW(field['hwnd'],0x0102,8,0)
        user32.SendMessageW(field['hwnd'],0x0102,ord(str(path)[-1]),0) # Native edit change notifies the dialog model.
        time.sleep(.15)
        entered=ctypes.create_unicode_buffer(2048);user32.SendMessageW(field['hwnd'],0x000D,2048,ctypes.cast(entered,ctypes.c_void_p).value);assert entered.value==str(path),(field,entered.value)
        buttons=[c for c in children if c['class']=='Button' and c['id']==1]
        assert buttons,children
        user32.PostMessageW(buttons[0]['hwnd'],0x00F5,0,0)
    def snap(path=DATABASE):
        with closing(sqlite3.connect(f'file:{path.as_posix()}?mode=ro',uri=True)) as db:
            return {t:db.execute(f'SELECT * FROM {t} ORDER BY 1').fetchall() for t in ['tasks','lists','tags','task_tags','reminders','settings']}
    def decline_overwrite():
        def respond():
            for hwnd in owned_windows(session.pid,'#32770'):
                if not user32.IsWindowVisible(hwnd):continue
                caption=ctypes.create_unicode_buffer(256);user32.GetWindowTextW(hwnd,caption,256)
                controls=child_windows(hwnd)
                rust_prompt=caption.value=='确认覆盖备份'
                choices=[c for c in controls if c['class']=='Button'and(c['id']==(7 if rust_prompt else 6)or(('否'if rust_prompt else'是')in c['text']))]
                if choices:
                    report.setdefault('overwrite_prompts',[]).append(caption.value)
                    user32.PostMessageW(choices[0]['hwnd'],0x00F5,0,0)
                    return rust_prompt
            return False
        wait(respond,25)
    def record(name,shot=False):
        report['checks'].append({'name':name,'status':'PASS','snapshot':snap()})
        if shot:session.screenshot(name)
        print('PASS '+name,flush=True)
    def quit_app():
        status=invoke('lifecycle_status')['value'];pid=session.pid
        if status=='tray-unavailable':
            hwnd=next(w['hwnd'] for w in native_windows(pid) if w['title']=='Todoa');user32.PostMessageW(hwnd,0x0010,0,0)
        else:
            tray_hwnd=wait(lambda:(owned_windows(pid,'tray_icon_app')or[None])[0]);rect=wintypes.RECT()
            def icon():
                for id in range(1,17):
                    ident=IconIdentifier(ctypes.sizeof(IconIdentifier),tray_hwnd,id)
                    if shell32.Shell_NotifyIconGetRect(ctypes.byref(ident),ctypes.byref(rect))==0:return True
                return False
            assert icon()
            tray=user32.FindWindowW('Shell_TrayWnd',None);notify=user32.FindWindowExW(tray,None,'TrayNotifyWnd',None);chevron=user32.FindWindowExW(notify,None,'Button',None)
            overflow=user32.FindWindowW('NotifyIconOverflowWindow',None)
            if chevron and (not overflow or not user32.IsWindowVisible(overflow)):user32.SendMessageW(chevron,0x00F5,0,0);time.sleep(.3)
            assert icon();user32.SetCursorPos((rect.left+rect.right)//2,(rect.top+rect.bottom)//2);user32.mouse_event(8,0,0,0,0);user32.mouse_event(16,0,0,0,0)
            popup=wait(lambda:(owned_windows(pid,'#32768')or[None])[0]);handle=user32.SendMessageW(popup,0x01E1,0,0)
            labels=[]
            for i in range(user32.GetMenuItemCount(handle)):
                text=ctypes.create_unicode_buffer(128);user32.GetMenuStringW(handle,i,text,128,0x400);labels.append(text.value)
            assert labels==['显示主窗口','快速添加','退出']
            r=wintypes.RECT();assert user32.GetMenuItemRect(None,handle,2,ctypes.byref(r));time.sleep(.3)
            user32.SetCursorPos((r.left+r.right)//2,(r.top+r.bottom)//2);user32.mouse_event(2,0,0,0,0);user32.mouse_event(4,0,0,0,0)
        wait(lambda:pid not in app_pids(),20)
        assert not app_pids()
    try:
        env=os.environ.copy();env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']=f'--remote-debugging-port={cdp}'
        app=subprocess.Popen([str(ROOT/'src-tauri/target/debug/todoa.exe')],env=env,creationflags=HIDDEN,stdout=log,stderr=log)
        wait(lambda:app.pid in app_pids());attach(app.pid)
        if args.clean_known_fixture:
            prior_marker=DATABASE.parent/'.restore/test-fail-sql-preload'
            if prior_marker.exists():
                assert prior_marker.read_text(encoding='utf-8')=='isolated debug fault'
                prior_marker.unlink()
            for task in snap()['tasks']:
                if task[1] is not None:button('BackupList')
                session.click(f'[aria-label="删除：{task[2]}"]');button('永久删除');wait(lambda:not snap()['tasks'])
            for query in ["DELETE FROM lists WHERE name='BackupList'","DELETE FROM tags WHERE name='BackupTag'","DELETE FROM settings WHERE key='backup-test'"]:
                assert 'value'in invoke('plugin:sql|execute',{'db':'sqlite:todo.db','query':query,'values':[]})
            report['fixture_cleanup']='known titles/IDs and dedicated database path checked; normal UI/SQL APIs only'
            session.script('location.reload()');session.ready()
        session.keys('Backup STEP18 fixture\ue007');wait(lambda:len(snap()['tasks'])==1)
        task=snap()['tasks'][0][0]
        # All writes use the existing constrained IPC against an identity-checked DB.
        def sql(query,values=[]):
            value=invoke('plugin:sql|execute',{'db':'sqlite:todo.db','query':query,'values':values});assert 'value'in value,value
        now=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
        sql("INSERT INTO lists(name,created_at,updated_at) VALUES('BackupList',?,?)",[now,now]);sql('UPDATE tasks SET list_id=1 WHERE id=?',[task])
        sql("INSERT INTO tags(name,created_at,updated_at) VALUES('BackupTag',?,?)",[now,now]);sql('INSERT INTO task_tags(task_id,tag_id) VALUES(?,1)',[task])
        sql("INSERT INTO settings(key,value,updated_at) VALUES('backup-test','saved',?)",[now])
        due=(datetime.now(timezone.utc)+timedelta(seconds=75)).isoformat(timespec='milliseconds').replace('+00:00','Z')
        assert 'value'in invoke('create_reminder',{'taskId':task,'remindAt':due})
        record('01-isolated-relations-and-wal',True)
        button('备份数据');dialog(cancel=True);wait(lambda:'已取消' in session.text());record('02-save-dialog-cancel')
        backup=fixtures/'snapshot.db';button('备份数据');dialog(backup);wait(lambda:'备份已保存' in session.text(),30)
        expected=snap(backup);assert expected==snap();assert not Path(str(backup)+'-wal').exists();record('03-rust-vacuum-snapshot',True)
        original_bytes=backup.read_bytes();button('备份数据');dialog(backup);decline_overwrite();wait(lambda:'已取消'in session.text());assert backup.read_bytes()==original_bytes;record('03b-explicit-overwrite-declined')
        corrupted=fixtures/'corrupt.db';corrupted.write_bytes(b'broken SQLite backup')
        journal_file=DATABASE.parent/'.restore/journal.json';journal_before=journal_file.read_bytes()if journal_file.exists()else None
        begin_restore();dialog(corrupted);wait(lambda:'恢复失败：' in session.text());assert snap()==expected;assert (journal_file.read_bytes()if journal_file.exists()else None)==journal_before;record('04-corrupt-restore-rejected',True)
        button('取消恢复');begin_restore();dialog(cancel=True);wait(lambda:'已取消' in session.text());assert snap()==expected;record('05-open-dialog-cancel')
        # Change the selected identity and populate old Query data before full restart.
        sql("UPDATE tasks SET title='Old cache must disappear' WHERE id=?",[task]);session.script('location.reload()');session.ready();button('BackupList');wait(lambda:'Old cache must disappear'in session.text())
        # Keep a real external SQLite handle open across restart. Windows refuses the
        # original group rename; production recovery must retain the old data.
        locked_data=snap()
        with closing(sqlite3.connect(f'file:{DATABASE.as_posix()}?mode=ro',uri=True)) as external:
            external.execute('SELECT count(*) FROM tasks').fetchone()
            old_pid=session.pid;begin_restore();dialog(backup)
            wait(lambda:old_pid not in app_pids(),30);new_pid=wait(lambda:next(iter(app_pids()),None),30);attach(new_pid)
            wait(lambda:'RESTORE_MOVE'in session.text());assert '原数据库已恢复'in session.text();assert snap()==locked_data
            assert json.loads((DATABASE.parent/'.restore/journal.json').read_text(encoding='utf-8'))['phase']=='failed'
            record('06-real-external-file-lock-safe-rollback',True)
        old_pid=session.pid;begin_restore();dialog(backup)
        wait(lambda:old_pid not in app_pids(),30);new_pid=wait(lambda:next(iter(app_pids()),None),30);assert new_pid!=old_pid
        report['process_restarts'].append({'old_exited':old_pid,'new':new_pid});attach(new_pid)
        wait(lambda:'恢复成功'in session.text());assert 'Old cache must disappear'not in session.text()
        # Inbox is empty because the restored task is in its saved list; select the actual list.
        button('BackupList');wait(lambda:'Backup STEP18 fixture'in session.text());assert snap()==expected;record('06-controlled-restart-query-rebuilt',True)
        journal=json.loads((DATABASE.parent/'.restore/journal.json').read_text(encoding='utf-8'));assert journal['phase']=='committed'
        original=DATABASE.parent/'backups'/journal['history'];assert snap(original)['tasks'][0][2]=='Old cache must disappear';record('07-before-restore-snapshot-retained')
        # Test the actual scheduler's fresh pending state, independent of stale renderer IDs.
        scheduler=invoke('reminder_scheduler_status');assert scheduler.get('value')in ['ready','notification-setting-unknown'],scheduler
        wait(lambda:snap()['reminders'][0][3]is not None,timeout=100);assert snap(backup)['reminders'][0][3]is None;record('08-restored-scheduler-real-api-trigger-state',True)
        assert invoke('restore_database',{'confirmed':False}).get('denial')=='RESTORE_CONFIRMATION_REQUIRED'
        assert 'denial'in invoke('plugin:dialog|open',{'options':{}})
        assert 'denial'in invoke('plugin:fs|read_file',{'path':str(DATABASE)})
        invoke('show_quick_add');handles=session.call('GET','/window/handles')
        for handle in handles:
            session.call('POST','/window',{'handle':handle})
            if session.script('return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label')=='quick-add':break
        for cmd in ['backup_database','restore_database','restore_status']:
            denial=invoke(cmd,{'confirmed':True});assert 'denial'in denial;report['denials'].append({'command':cmd,**denial})
        session.call('POST','/window',{'handle':session.main_handle});time.sleep(6)
        # An actual plugin migration checksum failure, after replacement and before Ready.
        original_data=snap();marker=DATABASE.parent/'.restore/test-fail-sql-preload';marker.write_text('isolated debug fault',encoding='utf-8')
        old_pid=session.pid;begin_restore();dialog(backup)
        wait(lambda:old_pid not in app_pids(),30);failed_pid=wait(lambda:next(iter(app_pids()),None),30);attach(failed_pid,False)
        assert '原数据库已恢复'in session.text();assert snap()==original_data
        failed_journal=json.loads((DATABASE.parent/'.restore/journal.json').read_text(encoding='utf-8'));assert failed_journal['phase']=='failed'
        assert 'denial'in invoke('database_boot_status');record('09-real-plugin-migration-error-rollback-ready-gate',True)
        quit_app();assert not app_pids()
        app=subprocess.Popen([str(ROOT/'src-tauri/target/debug/todoa.exe')],env=env,creationflags=HIDDEN,stdout=log,stderr=log)
        wait(lambda:app.pid in app_pids());attach(app.pid);assert snap()==original_data
        assert json.loads((DATABASE.parent/'.restore/journal.json').read_text(encoding='utf-8'))['phase']=='failed';marker.unlink();record('10-failed-restore-does-not-retry-next-start',True)
        quit_app();report['normal_exit']=True
        report['status']='PASS'
    except Exception as error:
        report['status']='FAIL';report['error']=repr(error)
        if session:
            try:report['body']=session.text();session.screenshot('failure')
            except Exception:pass
        raise
    finally:
        (evidence/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(evidence/'report.json')
        if session and session.pid in app_pids():
            # Cleanup is explicitly not a normal-exit assertion.
            subprocess.run(['taskkill','/PID',str(session.pid),'/T','/F'],creationflags=HIDDEN,capture_output=True)
        if driver:
            subprocess.run(['taskkill','/PID',str(driver.pid),'/T','/F'],creationflags=HIDDEN,capture_output=True);driver.wait()
        log.close()

if __name__=='__main__':main()

