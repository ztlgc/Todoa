"""STEP 17 actual Windows API delivery and restart in isolated identifier."""
import sys
sys.dont_write_bytecode=True
import argparse,ctypes,json,os,sqlite3,subprocess,time,socket
from pathlib import Path
from datetime import datetime,timedelta
from urllib.request import urlopen
from step8_native import NativeSession,HIDDEN,wait,app_pids,ELEMENT
from step12_native import native_windows
from step15_native import owned_windows,user32,shell32,IconIdentifier,wintypes,ImageGrab
ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--native-driver',type=Path,required=True);parser.add_argument('--clean-known-fixture',action='store_true');args=parser.parse_args()
    identifier='com.todoa.desktop.test.step17'
    database=Path(os.environ['APPDATA'])/identifier/'todo.db'
    evidence=ROOT/'docs/evidence'/('step17-'+datetime.now().strftime('%Y%m%d-%H%M%S'));evidence.mkdir()
    report={'identifier':identifier,'checks':[],'denials':[],'fake_in_app':False}
    session=None;driver=None;log=(evidence/'driver.txt').open('w',encoding='utf-8')
    def start():
        nonlocal driver,session
        assert not app_pids()
        # Fresh ports after each normal app exit avoid EdgeDriver TIME_WAIT bind failures.
        with socket.socket() as a, socket.socket() as b:
            a.bind(("127.0.0.1",0));b.bind(("127.0.0.1",0));port=a.getsockname()[1];native_port=b.getsockname()[1]
        driver=subprocess.Popen([str(Path.home()/'.cargo/bin/tauri-driver.exe'),'--port',str(port),'--native-port',str(native_port),'--native-driver',str(args.native_driver)],stdout=log,stderr=log,creationflags=HIDDEN)
        def ready():
            try:return json.load(urlopen(f'http://127.0.0.1:{port}/status',timeout=2))['value']['ready']
            except Exception:return False
        wait(ready);session=NativeSession(ROOT/'src-tauri/target/x86_64-pc-windows-msvc/debug/todoa.exe',port,evidence,identifier)
    def invoke(command,arguments=None):
        return session.call('POST','/execute/async',{'script':"const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({denial:String(error)}));",'args':[command,arguments or {}]})
    def snapshot():
        with sqlite3.connect(f'file:{database.as_posix()}?mode=ro',uri=True) as db:
            return {'tasks':db.execute('SELECT id,title,status,completed_at FROM tasks ORDER BY id').fetchall(),'reminders':db.execute('SELECT id,task_id,remind_at,triggered_at FROM reminders ORDER BY id').fetchall(),'fk':db.execute('PRAGMA foreign_key_check').fetchall()}
    def record(name,shot=False):
        report['checks'].append({'name':name,'status':'PASS','database':snapshot()});
        if shot:session.screenshot(name)
    def button(text):
        el=wait(lambda:session.script("return [...document.querySelectorAll('button')].find(b=>b.textContent.trim()===arguments[0])",text));session.call('POST',f"/element/{el[ELEMENT]}/click",{})
    def date_input(value):
        # WebView's datetime-local WebDriver text behavior differs by locale.
        # Set via native DOM setter + input/change; actual save uses WebDriver click.
        session.script("const e=document.querySelector('input[type=datetime-local]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,arguments[0]);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));",value)
    def open_panel():button('提醒');wait(lambda:session.elements('input[type=datetime-local]'))
    def icon_rect():
        hwnd=wait(lambda:(owned_windows(session.pid,'tray_icon_app')or[None])[0]);rect=wintypes.RECT()
        for icon_id in range(1,17):
            ident=IconIdentifier(ctypes.sizeof(IconIdentifier),hwnd,icon_id)
            if shell32.Shell_NotifyIconGetRect(ctypes.byref(ident),ctypes.byref(rect))==0:return rect
        raise AssertionError('Native tray absent')
    def click_point(x,y,right=False):
        user32.SetCursorPos(x,y)
        user32.mouse_event(0x8 if right else 0x2,0,0,0,0)
        user32.mouse_event(0x10 if right else 0x4,0,0,0,0)
    def menu(label):
        rect=icon_rect()
        # Newly created icons may be in the real Windows overflow flyout.
        tray = user32.FindWindowW('Shell_TrayWnd',None)
        notify = user32.FindWindowExW(tray,None,'TrayNotifyWnd',None)
        chevron = user32.FindWindowExW(notify,None,'Button',None)
        overflow=user32.FindWindowW('NotifyIconOverflowWindow',None)
        if chevron and (not overflow or not user32.IsWindowVisible(overflow)):
            user32.SendMessageW(chevron,0x00F5,0,0)  # Actual Shell chevron BM_CLICK.
            time.sleep(0.2)
        rect=icon_rect()
        click_point((rect.left+rect.right)//2,(rect.top+rect.bottom)//2,True)
        popup=wait(lambda: (owned_windows(session.pid,'#32768') or [None])[0])
        handle=user32.SendMessageW(popup,0x01E1,0,0)  # MN_GETHMENU, native popup.
        labels=[]
        for index in range(user32.GetMenuItemCount(handle)):
            text=ctypes.create_unicode_buffer(128); user32.GetMenuStringW(handle,index,text,128,0x400); labels.append(text.value)
        assert labels==['显示主窗口','快速添加','退出'],labels
        report.setdefault('native_menus',[]).append(labels)
        time.sleep(0.2)  # Wait for Windows menu fade-in before its visual capture.
        popup_rect=wintypes.RECT(); user32.GetWindowRect(popup,ctypes.byref(popup_rect))
        ImageGrab.grab(bbox=(popup_rect.left,popup_rect.top,popup_rect.right,popup_rect.bottom)).save(evidence/'tray-menu.png')
        item_rect=wintypes.RECT(); assert user32.GetMenuItemRect(None,handle,labels.index(label),ctypes.byref(item_rect))
        click_point((item_rect.left+item_rect.right)//2,(item_rect.top+item_rect.bottom)//2)

    def quit_and_reset():
        nonlocal session,driver
        pid=session.pid
        status=invoke('lifecycle_status')['value']
        if status=='tray-ready':menu('退出')
        else:
            assert status=='tray-unavailable' and '托盘不可用' in session.text()
            hwnd=next(w['hwnd'] for w in native_windows(pid) if w['title']=='Todoa');user32.PostMessageW(hwnd,0x0010,0,0)
            report.setdefault('native_close_fallback',[]).append('tray-unavailable: visible Main close exits')
        wait(lambda:pid not in app_pids(),timeout=20)
        assert user32.RegisterHotKey(None,1601,0x4006,0x20),'Shortcut leaked';user32.UnregisterHotKey(None,1601)
        try:session.call('DELETE','')
        except RuntimeError:pass
        session.session=None;session=None
        subprocess.run(['taskkill','/PID',str(driver.pid),'/T','/F'],creationflags=HIDDEN,capture_output=True,check=True);driver.wait(timeout=10);driver=None
    try:
        start()
        if snapshot()['tasks'] and args.clean_known_fixture:
            assert len(snapshot()['tasks'])==1 and snapshot()['tasks'][0][1]=='Notification STEP17 fixture'
            session.click('[aria-label="删除：Notification STEP17 fixture"]');button('永久删除');wait(lambda:snapshot()['tasks']==[])
            report['known_fixture_cleanup']='exact title verified; rendered Main UI delete'
        assert snapshot()['tasks']==[],'Refusing nonempty fixture'
        report['initial_availability']=invoke('reminder_scheduler_status');assert report['initial_availability'].get('value') in ['ready','notification-setting-unknown'],report['initial_availability']
        session.keys('Notification STEP17 fixture\ue007');wait(lambda:len(snapshot()['tasks'])==1);task=snapshot()['tasks'][0][0]
        open_panel();wait(lambda:'API 接受' in session.text());record('01-windows-notification-availability',True)
        def utc_after(seconds):
            from datetime import timezone
            return (datetime.now(timezone.utc)+timedelta(seconds=seconds)).isoformat(timespec='milliseconds').replace('+00:00','Z')
        def create(seconds=2):
            result=invoke('create_reminder',{'taskId':task,'remindAt':utc_after(seconds)});assert 'value' in result,result;return result['value']
        def row(id):return next(r for r in snapshot()['reminders'] if r[0]==id)
        def sql(query,values=[]):
            result=invoke('plugin:sql|execute',{'db':'sqlite:todo.db','query':query,'values':values});assert 'value' in result,result
        first=create();assert row(first)[3] is None
        wait(lambda:row(first)[3] is not None,timeout=15);wait(lambda:'API 已接受' in session.text());record('02-actual-api-success-marks-triggered',True)
        # Malformed XML control character reaches the real WinRT backend; no fake fault hook.
        sql('UPDATE tasks SET title=? WHERE id=?',['Notification STEP17 fixture\u0001',task])
        failed=create();wait(lambda:invoke('reminder_scheduler_status').get('value')=='NOTIFICATION_API_FAILED',timeout=15)
        assert row(failed)[3] is None;wait(lambda:'通知暂不可用或发送失败' in session.text());record('03-real-api-error-remains-pending',True)
        sql('UPDATE tasks SET title=? WHERE id=?',['Notification STEP17 fixture',task])
        wait(lambda:row(failed)[3] is not None,timeout=15);wait(lambda:invoke('reminder_scheduler_status').get('value') in ['ready','notification-setting-unknown']);record('04-error-retry-success-marks')
        # Future reminder survives a normal Quit and becomes overdue while process is absent.
        catchup=create(15);assert row(catchup)[3] is None;time.sleep(6);quit_and_reset();time.sleep(16)
        with sqlite3.connect(f'file:{database.as_posix()}?mode=ro',uri=True) as db:
            assert db.execute('SELECT triggered_at FROM reminders WHERE id=?',(catchup,)).fetchone()[0] is None
        start();wait(lambda:row(catchup)[3] is not None,timeout=15);assert row(first)[3] is not None;open_panel();record('05-restart-overdue-catchup',True)
        before=snapshot()['reminders'];time.sleep(6);quit_and_reset();start();time.sleep(2);assert snapshot()['reminders']==before;record('06-triggered-state-persists-no-resend')
        invoke('show_quick_add')
        for handle in session.call('GET','/window/handles'):
            session.call('POST','/window',{'handle':handle})
            if session.script('return window.__TAURI_INTERNALS__.metadata.currentWindow.label')=='quick-add':break
        for command in ['plugin:notification|notify','plugin:notification|permission_state','reminder_scheduler_status']:
            result=invoke(command,{'options':{'title':'Unauthorized'},'id':first});assert 'not allowed' in result.get('denial','').lower(),result;report['denials'].append({'window':'quick-add','command':command,**result})
        session.call('POST','/window',{'handle':session.main_handle})
        result=invoke('plugin:notification|notify',{'options':{'title':'Unauthorized'}});assert 'not allowed' in result.get('denial','').lower(),result;report['denials'].append({'window':'main','command':'plugin:notification|notify',**result});record('07-rust-only-notification-acl')
        session.click('[aria-label="删除：Notification STEP17 fixture"]');button('永久删除');wait(lambda:snapshot()['tasks']==[]);assert snapshot()['reminders']==[];record('08-ui-cleanup',True);quit_and_reset()
        report['normal_exit_and_hotkey_cleanup']='PASS each restart'
        report['production_database_exists']=(Path(os.environ['APPDATA'])/'com.todoa.desktop'/'todo.db').exists()
        report['api_acceptance']='WinRT Show returned success before triggered_at was written'
        report['user_saw_notification']='NOT VERIFIED: API acceptance is not display/read proof'
        report['installed_name_icon_display']='STEP 22 release gate'

    except Exception as error:
        report['error']=repr(error)
        if session:
            try:session.screenshot('failure')
            except Exception:pass
        raise
    finally:
        (evidence/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        if session:session.close()
        if driver:
            subprocess.run(['taskkill','/PID',str(driver.pid),'/T','/F'],capture_output=True,creationflags=HIDDEN);driver.wait(timeout=10)
        log.close();print(json.dumps({'evidence':str(evidence),'checks':len(report['checks']),'error':report.get('error')},ensure_ascii=False))
if __name__=='__main__':main()
