"""Native tray menu clicks, single-instance wake-up and quiescent Quit."""
import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
from urllib.request import urlopen

sys.dont_write_bytecode = True
from step8_native import NativeSession, HIDDEN, wait, app_pids
from step12_native import native_windows, user32, CALLBACK
from PIL import ImageGrab

ROOT = Path(__file__).resolve().parents[1]
user32.SetProcessDPIAware()
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
user32.FindWindowW.restype = wintypes.HWND
user32.FindWindowExW.argtypes = [wintypes.HWND, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR]
user32.FindWindowExW.restype = wintypes.HWND
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.GetMenuItemCount.argtypes = [wintypes.HMENU]
user32.GetMenuStringW.argtypes = [wintypes.HMENU, wintypes.UINT, wintypes.LPWSTR, ctypes.c_int, wintypes.UINT]
user32.GetMenuItemRect.argtypes = [wintypes.HWND, wintypes.HMENU, wintypes.UINT, ctypes.POINTER(wintypes.RECT)]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user32.mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_size_t]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT]
user32.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]

class GUID(ctypes.Structure):
    _fields_ = [('a', wintypes.DWORD), ('b', wintypes.WORD), ('c', wintypes.WORD), ('d', ctypes.c_ubyte * 8)]
class IconIdentifier(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('hwnd', wintypes.HWND), ('id', wintypes.UINT), ('guid', GUID)]
shell32 = ctypes.WinDLL('shell32')
shell32.Shell_NotifyIconGetRect.argtypes = [ctypes.POINTER(IconIdentifier), ctypes.POINTER(wintypes.RECT)]
shell32.Shell_NotifyIconGetRect.restype = ctypes.c_long


def owned_windows(pid, class_name):
    result = []
    @CALLBACK
    def collect(hwnd, _):
        owner = wintypes.DWORD(); user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        name = ctypes.create_unicode_buffer(256); user32.GetClassNameW(hwnd, name, 256)
        if owner.value == pid and name.value == class_name: result.append(int(hwnd))
        return True
    user32.EnumWindows(collect, 0)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--native-driver', type=Path, required=True)
    parser.add_argument('--no-tray', action='store_true')
    parser.add_argument('--clean-known-fixture', action='store_true')
    args = parser.parse_args()
    identifier = 'com.todoa.desktop.test.step15' + ('.no-tray' if args.no_tray else '')
    database = Path(os.environ['APPDATA']) / identifier / 'todo.db'
    evidence = ROOT / 'docs/evidence' / (('step15-no-tray-' if args.no_tray else 'step15-') + datetime.now().strftime('%Y%m%d-%H%M%S'))
    evidence.mkdir()
    report = {'identifier': identifier, 'checks': [], 'denials': []}
    log = (evidence / 'driver.txt').open('w', encoding='utf-8')
    driver = subprocess.Popen([str(Path.home() / '.cargo/bin/tauri-driver.exe'), '--port', '4510', '--native-port', '4511', '--native-driver', str(args.native_driver)], stdout=log, stderr=log, creationflags=HIDDEN)
    session = None
    reset_before_start = False
    def start():
        nonlocal driver, reset_before_start
        if reset_before_start:
            # A WebView2 driver can retain an invalid HWND after all app windows
            # were destroyed. The app has already exited; reset only this driver tree.
            assert not app_pids()
            subprocess.run(['taskkill','/PID',str(driver.pid),'/T','/F'],creationflags=HIDDEN,capture_output=True,check=True)
            driver.wait(timeout=10)
            driver=subprocess.Popen([str(Path.home()/'.cargo/bin/tauri-driver.exe'),'--port','4510','--native-port','4511','--native-driver',str(args.native_driver)],stdout=log,stderr=log,creationflags=HIDDEN)
            def ready_again():
                try: return json.load(urlopen('http://127.0.0.1:4510/status',timeout=2))['value']['ready']
                except Exception: return False
            wait(ready_again)
            reset_before_start=False
        return NativeSession(ROOT / 'src-tauri/target/x86_64-pc-windows-msvc/debug/todoa.exe', 4510, evidence, identifier)
    def switch(handle): session.call('POST', '/window', {'handle': handle})
    def invoke(command, arguments=None):
        return session.call('POST', '/execute/async', {'script': "const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({denial:String(error)}));", 'args': [command, arguments or {}]})
    def snapshot():
        with sqlite3.connect(f'file:{database.as_posix()}?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row
            return [dict(row) for row in db.execute('SELECT * FROM tasks ORDER BY id')]
    def window(title): return next(w for w in native_windows(session.pid) if w['title']==title)
    def close_main(): user32.PostMessageW(window('Todoa')['hwnd'],0x0010,0,0)
    def record(name, screenshot=False):
        item={'name':name,'status':'PASS','tasks':snapshot(), 'windows':native_windows(session.pid) if session else []}
        if screenshot: item['screenshot']=session.screenshot(name)
        report['checks'].append(item); print('PASS '+name,flush=True)
    def icon_rect():
        hwnds = owned_windows(session.pid,'tray_icon_app'); assert len(hwnds)==1,hwnds
        # tray-icon's builder and Windows backend each allocate an internal ID.
        for icon_id in range(1,17):
            key=IconIdentifier(ctypes.sizeof(IconIdentifier),hwnds[0],icon_id,GUID()); rect=wintypes.RECT()
            if shell32.Shell_NotifyIconGetRect(ctypes.byref(key),ctypes.byref(rect))==0:
                report['shell_icon_id']=icon_id
                return rect
        raise AssertionError('Icon missing from Shell')
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
    def second():
        child=subprocess.Popen([str(ROOT/'src-tauri/target/x86_64-pc-windows-msvc/debug/todoa.exe')],creationflags=HIDDEN)
        try:
            assert child.wait(timeout=12)==0
        finally:
            if child.poll() is None: child.terminate(); child.wait(timeout=5)
        wait(lambda: app_pids()=={session.pid})
    def ended():
        nonlocal session, reset_before_start
        wait(lambda: session.pid not in app_pids(),timeout=18)
        try: session.call('DELETE','')
        except RuntimeError: pass
        session.session=None; session=None
        reset_before_start=True
        assert user32.RegisterHotKey(None,1501,0x4006,0x20),'Shortcut leaked'
        user32.UnregisterHotKey(None,1501)
    try:
        def ready():
            try: return json.load(urlopen('http://127.0.0.1:4510/status',timeout=2))['value']['ready']
            except Exception: return False
        wait(ready); session=start()
        if args.no_tray:
            wait(lambda:'托盘不可用' in session.text())
            assert invoke('lifecycle_status')=={'value':'tray-unavailable'}
            assert not owned_windows(session.pid,'tray_icon_app')
            record('01-tray-failure-explicit-no-hidden-icon',True)
            close_main(); ended(); record('02-main-close-normally-exits-and-unregisters')
        else:
            assert invoke('lifecycle_status')=={'value':'tray-ready'}
            if snapshot() and args.clean_known_fixture:
                rows=snapshot()
                assert {row['title'] for row in rows} <= {'Main after tray','Pending at Quit','Main pending at Quit'}
                assert all(row['status']=='todo' and row['list_id'] is None and row['notes']=='' and row['due_at'] is None for row in rows)
                for row in rows:
                    session.click('[aria-label='+json.dumps('删除：'+row['title'],ensure_ascii=False)+']')
                    button=wait(lambda:session.script("return [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='永久删除')"))
                    session.call('POST',f"/element/{button['element-6066-11e4-a52e-4f735466cecf']}/click",{})
                    wait(lambda:not any(task['id']==row['id'] for task in snapshot()))
                report['known_fixture_cleanup']='rendered Main UI only'
            assert not snapshot(),'Refusing nonempty fixture'
            initial_tray=owned_windows(session.pid,'tray_icon_app'); assert len(initial_tray)==1
            icon_rect(); record('01-real-shell-tray-ready',True)
            close_main(); wait(lambda:not window('Todoa')['visible'])
            assert app_pids()=={session.pid}; record('02-close-hides-main-with-live-database')
            menu('显示主窗口'); wait(lambda:window('Todoa')['visible'] and window('Todoa')['foreground'])
            session.ready(); session.keys('Main after tray\ue007')
            wait(lambda:any(row['title']=='Main after tray' for row in snapshot()))
            record('03-native-menu-recovers-main-and-crud',True)
            close_main(); wait(lambda:not window('Todoa')['visible']); second()
            wait(lambda:window('Todoa')['visible'] and window('Todoa')['foreground'])
            assert owned_windows(session.pid,'tray_icon_app')==initial_tray
            record('04-second-launch-wakes-hidden-main-one-process-one-tray',True)
            user32.ShowWindow(window('Todoa')['hwnd'],6); wait(lambda:user32.IsIconic(window('Todoa')['hwnd']))
            second(); wait(lambda:not user32.IsIconic(window('Todoa')['hwnd']) and window('Todoa')['foreground'])
            assert owned_windows(session.pid,'tray_icon_app')==initial_tray
            record('05-second-launch-unminimizes-same-main',True)
            menu('快速添加'); wait(lambda:window('Todoa · 快速添加')['foreground'])
            for handle in session.call('GET','/window/handles'):
                switch(handle)
                if session.script('return window.__TAURI_INTERNALS__.metadata.currentWindow.label')=='quick-add': quick_handle=handle; break
            wait(lambda:session.script("return document.activeElement?.id==='quick-title'"))
            for command in ['lifecycle_status','begin_main_write','finish_main_write']:
                result=invoke(command,{'id':1}); assert 'not allowed' in result.get('denial','').lower(),result
                report['denials'].append({'command':command,**result})
            record('06-tray-quick-add-focus-and-main-lifecycle-acl',True)
            with sqlite3.connect(database,timeout=1,isolation_level=None) as lock:
                lock.execute('BEGIN IMMEDIATE')
                session.call('POST',f"/element/{session.element('#quick-title')}/value",{'text':'Pending at Quit\ue007'})
                wait(lambda:session.script("return document.querySelector('#quick-title').disabled"))
                menu('退出')
                wait(lambda:'正在退出' in session.text())
                assert invoke('create_quick_task',{'title':'Must be rejected'})=={'denial':'APP_QUITTING'}
                switch(session.main_handle)
                assert invoke('begin_main_write')=={'denial':'APP_QUITTING'}
                assert app_pids()=={session.pid},'Quit ended before pending write drained'
                record('07-quit-rejects-new-writes-and-waits-existing',True)
                # During quitting neither close handler may hide/prevent destruction.
                close_main(); wait(lambda:all(w['title']!='Todoa' for w in native_windows(session.pid)))
                user32.PostMessageW(window('Todoa · 快速添加')['hwnd'],0x0010,0,0)
                wait(lambda:not native_windows(session.pid))
                assert app_pids()=={session.pid}
                lock.execute('ROLLBACK')
            ended()
            assert {r['title'] for r in snapshot()}=={'Main after tray','Pending at Quit'}
            record('08-close-handlers-do-not-intercept-quit-write-committed-hotkey-released')
            session=start(); assert invoke('lifecycle_status')=={'value':'tray-ready'}
            assert len(owned_windows(session.pid,'tray_icon_app'))==1
            session.ready(); wait(lambda:'Pending at Quit' in session.text())
            record('09-restart-persistence-and-one-tray',True)
            with sqlite3.connect(database,timeout=1,isolation_level=None) as lock:
                lock.execute('BEGIN IMMEDIATE')
                session.keys('Main pending at Quit\ue007')
                wait(lambda:session.script("return document.querySelector('#task-title').disabled"))
                menu('退出'); wait(lambda:'正在退出' in session.text())
                assert app_pids()=={session.pid}
                assert invoke('begin_main_write')=={'denial':'APP_QUITTING'}
                record('10-main-sql-write-inflight-quit-waits',True)
                lock.execute('ROLLBACK')
            ended()
            assert {row['title'] for row in snapshot()}=={'Main after tray','Pending at Quit','Main pending at Quit'}
            record('11-main-write-durable-before-normal-exit')
            session=start(); session.ready()
            record('12-restart-after-main-write',True)
            # Delete only these synthetic rows through Main UI, then actual tray Quit.
            for row in snapshot():
                session.click('[aria-label='+json.dumps('删除：'+row['title'],ensure_ascii=False)+']')
                button=wait(lambda:session.script("return [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='永久删除')"))
                session.call('POST',f"/element/{button['element-6066-11e4-a52e-4f735466cecf']}/click",{})
                wait(lambda:not any(task['id']==row['id'] for task in snapshot()))
            menu('退出'); ended(); record('13-tray-quit-normal-process-exit-and-cleanup')
        report['gate']='PASS'
    except Exception as error:
        report.update(gate='FAIL',error=str(error))
        if session:
            try: report['ui']=session.text(); session.screenshot('failure')
            except Exception: pass
        raise
    finally:
        if session: session.close()
        driver.terminate();driver.wait(timeout=10);log.close()
        (evidence/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print('EVIDENCE '+str(evidence),flush=True)


if __name__=='__main__':main()
