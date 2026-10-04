"""Native Ctrl+Shift+Space, conflict ownership and graceful exit verification."""
import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import urlopen

sys.dont_write_bytecode = True
from step8_native import NativeSession, HIDDEN, wait, app_pids
from step12_native import native_windows, user32

ROOT = Path(__file__).resolve().parents[1]
user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
user32.CreateWindowExW.restype = wintypes.HWND
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.DestroyWindow.argtypes = [wintypes.HWND]
user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT]
user32.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.SetFocus.argtypes = [wintypes.HWND]
user32.keybd_event.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, wintypes.DWORD, ctypes.c_size_t]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--native-driver', type=Path, required=True)
    args = parser.parse_args()
    evidence = ROOT / 'docs/evidence' / ('step14-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
    evidence.mkdir()
    report = {'checks': [], 'denials': []}
    log = (evidence / 'driver.txt').open('w', encoding='utf-8')
    driver = subprocess.Popen([str(Path.home() / '.cargo/bin/tauri-driver.exe'), '--port', '4500', '--native-port', '4501', '--native-driver', str(args.native_driver)], stdout=log, stderr=log, creationflags=HIDDEN)
    session = None
    host = user32.CreateWindowExW(0, 'STATIC', 'Todoa STEP14 Shortcut Test Host', 0x10CF0000, 100, 100, 480, 200, None, None, None, None)
    assert host
    owns = False
    def focus_host():
        own_thread = ctypes.windll.kernel32.GetCurrentThreadId()
        foreground_thread = user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), None)
        attached = bool(user32.AttachThreadInput(own_thread, foreground_thread, True)) if own_thread != foreground_thread else False
        try:
            user32.BringWindowToTop(host)
            user32.SetForegroundWindow(host)
            user32.SetFocus(host)
        finally:
            if attached: user32.AttachThreadInput(own_thread, foreground_thread, False)
        wait(lambda: user32.GetForegroundWindow() == host)
    def start():
        return NativeSession(ROOT / 'src-tauri/target/x86_64-pc-windows-msvc/debug/todoa.exe', 4500, evidence, 'com.todoa.desktop.test.step14')
    def switch(handle):
        session.call('POST', '/window', {'handle': handle})
    def quick():
        windows = [w for w in native_windows(session.pid) if w['title'] == 'Todoa · 快速添加']
        assert len(windows) == 1
        return windows[0]
    def invoke(command, args=None):
        return session.call('POST', '/execute/async', {'script': "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({denial:String(error)}));", 'args': [command, args or {}]})
    def record(name, screenshot=False):
        item = {'name': name, 'status': 'PASS', 'windows': native_windows(session.pid) if session else []}
        if screenshot:
            item['screenshot'] = session.screenshot(name)
        report['checks'].append(item); print('PASS ' + name, flush=True)
    def graceful_exit():
        nonlocal session
        switch(session.main_handle)
        main_window = next(w for w in native_windows(session.pid) if w['title'] == 'Todoa')
        user32.PostMessageW(main_window['hwnd'], 0x0010, 0, 0)
        wait(lambda: session.pid not in app_pids())
        # No taskkill: registration must be released by a real normal app exit.
        try:
            session.call('DELETE', '')
        except RuntimeError:
            pass
        session.session = None
        session = None
    try:
        def ready():
            try:
                return json.load(urlopen('http://127.0.0.1:4500/status', timeout=2))['value']['ready']
            except Exception:
                return False
        wait(ready)
        session = start()
        wait(lambda: 'Ctrl+Shift+Space 快速添加' in session.text())
        assert invoke('global_shortcut_status') == {'value': 'registered'}
        initial_hwnd = quick()['hwnd']
        assert not quick()['visible']
        for handle in session.call('GET', '/window/handles'):
            switch(handle)
            if session.script('return window.__TAURI_INTERNALS__.metadata.currentWindow.label') == 'quick-add':
                quick_handle = handle; break
        session.call('POST', '/execute/async', {'script': "const done=arguments[arguments.length-1];window.__shown=0;const handler=window.__TAURI_INTERNALS__.transformCallback(()=>window.__shown++);window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event:'quick-add-shown',target:{kind:'Window',label:'quick-add'},handler}).then(id=>done(id));", 'args': []})
        # Both windows must be unable to register, unregister or inspect arbitrary hotkeys.
        for handle in [session.main_handle, quick_handle]:
            switch(handle)
            for command, arguments in [('plugin:global-shortcut|register', {'shortcuts':['Ctrl+Shift+Space'], 'handler':0}), ('plugin:global-shortcut|unregister', {'shortcuts':['Ctrl+Shift+Space']}), ('plugin:global-shortcut|unregister_all', {}), ('plugin:global-shortcut|is_registered', {'shortcut':'Ctrl+Shift+Space'})]:
                result = invoke(command, arguments)
                assert 'denial' in result and 'not allowed' in result['denial'].lower(), result
                report['denials'].append({'command':command,'window':session.script('return window.__TAURI_INTERNALS__.metadata.currentWindow.label'), **result})
        denied_status = invoke('global_shortcut_status')
        assert 'denial' in denied_status and 'not allowed' in denied_status['denial'].lower()
        report['denials'].append({'command': 'global_shortcut_status', 'window': 'quick-add', **denied_status})
        record('01-rust-registration-and-frontend-acl')
        focus_host()
        assert not quick()['visible']
        for key in [0x11, 0x10, 0x20]: user32.keybd_event(key, 0, 0, 0)
        wait(lambda: quick()['visible'] and quick()['foreground'])
        user32.keybd_event(0x20, 0, 0, 0)  # Held key repeat must not open twice.
        time.sleep(0.15)
        for key in [0x20, 0x10, 0x11]: user32.keybd_event(key, 0, 2, 0)
        switch(quick_handle)
        wait(lambda: session.script("return document.hasFocus() && document.activeElement?.id==='quick-title'"))
        wait(lambda: session.script('return window.__shown') == 1)
        time.sleep(0.3)
        assert session.script('return window.__shown') == 1 and quick()['hwnd'] == initial_hwnd
        record('02-other-process-focus-one-press-one-show', True)
        assert invoke('hide_quick_add') == {'value': None}
        wait(lambda: not quick()['visible'])
        focus_host()
        for key in [0x11, 0x10, 0x20]: user32.keybd_event(key, 0, 0, 0)
        wait(lambda: quick()['foreground'])
        for key in [0x20, 0x10, 0x11]: user32.keybd_event(key, 0, 2, 0)
        switch(quick_handle); wait(lambda: session.script('return window.__shown') == 2)
        record('03-next-press-reuses-existing-window', True)
        graceful_exit()
        owns = bool(user32.RegisterHotKey(host, 1401, 0x4006, 0x20))
        assert owns, 'Shortcut was not released after normal exit'
        record('04-normal-exit-releases-hotkey')
        # Keep the host's OS registration held while starting the same isolated app.
        session = start()
        wait(lambda: '可能已被其他应用占用' in session.text())
        assert invoke('global_shortcut_status') == {'value': 'registration-failed'}
        record('05-os-conflict-reported-and-main-stays-ready', True)
        session.click('#show-quick-add')
        wait(lambda: quick()['visible'] and quick()['foreground'])
        assert len(session.call('GET', '/window/handles')) == 2
        record('06-conflict-main-button-still-opens-quick')
        graceful_exit()
        assert user32.UnregisterHotKey(host, 1401)
        owns = False
        session = start()
        wait(lambda: 'Ctrl+Shift+Space 快速添加' in session.text())
        assert invoke('global_shortcut_status') == {'value':'registered'}
        record('07-restart-after-conflict-registers-once', True)
        graceful_exit()
        owns = bool(user32.RegisterHotKey(host, 1401, 0x4006, 0x20)); assert owns
        record('08-final-normal-exit-releases-hotkey')
        report['gate']='PASS'
    except Exception as error:
        report.update(gate='FAIL', error=str(error))
        if session:
            try: session.screenshot('failure')
            except Exception: pass
        raise
    finally:
        for key in [0x20,0x10,0x11]: user32.keybd_event(key,0,2,0)
        if session: session.close()
        if owns: user32.UnregisterHotKey(host,1401)
        user32.DestroyWindow(host)
        driver.terminate(); driver.wait(timeout=10); log.close()
        (evidence/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print('EVIDENCE '+str(evidence),flush=True)


if __name__=='__main__': main()
