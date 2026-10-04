"""Real isolated Tauri Quick Add, native window state, IPC ACL and persistence."""
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
from urllib.request import urlopen

sys.dont_write_bytecode = True
from step8_native import NativeSession, HIDDEN, ELEMENT, wait

ROOT = Path(__file__).resolve().parents[1]
IDENTIFIER = 'com.todoa.desktop.test.step12'
DB = Path(os.environ['APPDATA']) / IDENTIFIER / 'todo.db'
user32 = ctypes.WinDLL('user32', use_last_error=True)
user32.GetForegroundWindow.restype = wintypes.HWND
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
CALLBACK = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows.argtypes = [CALLBACK, wintypes.LPARAM]


def native_windows(pid):
    windows = []
    @CALLBACK
    def collect(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid:
            title = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, title, 256)
            if title.value in ('Todoa', 'Todoa · 快速添加'):
                windows.append({'hwnd': int(hwnd), 'title': title.value, 'visible': bool(user32.IsWindowVisible(hwnd)), 'foreground': hwnd == user32.GetForegroundWindow()})
        return True
    user32.EnumWindows(collect, 0)
    return windows


def snapshot():
    with sqlite3.connect(f'file:{DB.as_posix()}?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        return {'tasks': [dict(row) for row in db.execute('SELECT * FROM tasks ORDER BY id')],
                'foreign_key_check': [list(row) for row in db.execute('PRAGMA foreign_key_check')],
                'schema': db.execute('PRAGMA user_version').fetchone()[0]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--native-driver', type=Path, required=True)
    args = parser.parse_args()
    evidence = ROOT / 'docs/evidence' / ('step12-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
    evidence.mkdir()
    report = {'database': str(DB), 'checks': [], 'denials': [], 'sessions': []}
    log = (evidence / 'driver.txt').open('w', encoding='utf-8')
    driver = subprocess.Popen([str(Path.home() / '.cargo/bin/tauri-driver.exe'), '--port', '4490', '--native-port', '4491', '--native-driver', str(args.native_driver)], stdout=log, stderr=log, creationflags=HIDDEN)
    session = None
    def start():
        native = NativeSession(ROOT / 'src-tauri/target/x86_64-pc-windows-msvc/debug/todoa.exe', 4490, evidence, IDENTIFIER)
        report['sessions'].append({'pid': native.pid, 'identifier': native.identifier})
        return native
    def invoke(command, arguments=None):
        return session.call('POST', '/execute/async', {'script': "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({denial:String(error)}));", 'args': [command, arguments or {}]})
    def switch(handle):
        session.call('POST', '/window', {'handle': handle})
    def quick_state():
        values = [window for window in native_windows(session.pid) if window['title'] == 'Todoa · 快速添加']
        assert len(values) == 1, values
        return values[0]
    def field(value):
        session.call('POST', f"/element/{session.element('#quick-title')}/value", {'text': '\ue009a\ue000\ue003' + value})
    def key(value):
        session.call('POST', f"/element/{session.element('#quick-title')}/value", {'text': value})
    def show():
        switch(session.main_handle)
        session.click('#show-quick-add')
        wait(lambda: quick_state()['visible'] and quick_state()['foreground'])
        switch(quick_handle)
        wait(lambda: session.script("return document.hasFocus() && document.activeElement?.id === 'quick-title'"))
    def hidden():
        wait(lambda: not quick_state()['visible'])
    def record(name, screenshot=False):
        state = snapshot()
        assert state['schema'] == 1 and not state['foreign_key_check']
        item = {'name': name, 'status': 'PASS', 'sqlite': state, 'windows': native_windows(session.pid)}
        if screenshot:
            item['screenshot'] = session.screenshot(name)
        report['checks'].append(item)
        print('PASS ' + name, flush=True)
    def denied(command, arguments=None):
        result = invoke(command, arguments)
        assert 'denial' in result and 'not allowed' in result['denial'].lower(), result
        report['denials'].append({'window': session.script('return window.__TAURI_INTERNALS__.metadata.currentWindow.label'), 'command': command, **result, 'status': 'PASS'})
        print('PASS denied ' + command, flush=True)
    try:
        def ready():
            try:
                return json.load(urlopen('http://127.0.0.1:4490/status', timeout=2))['value']['ready']
            except Exception:
                return False
        wait(ready)
        session = start()
        assert not snapshot()['tasks'], 'Refusing a nonempty isolated fixture'
        assert not quick_state()['visible']
        initial_hwnd = quick_state()['hwnd']
        handles = session.call('GET', '/window/handles')
        assert len(handles) == 2, handles
        for handle in handles:
            switch(handle)
            if session.script('return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label') == 'quick-add':
                quick_handle = handle
                break
        else:
            raise AssertionError('Quick Add WebView not found')
        switch(session.main_handle)
        # Independent observation of the committed, Main-targeted Rust event.
        session.call('POST', '/execute/async', {'script': "const done=arguments[arguments.length-1]; window.__createdIds=[]; const handler=window.__TAURI_INTERNALS__.transformCallback(e=>window.__createdIds.push(e.payload)); window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event:'task-created',target:{kind:'Window',label:'main'},handler}).then(id=>done(id));", 'args': []})
        denied('create_quick_task', {'title': 'Main must not write Quick command'})
        denied('hide_quick_add')
        record('01-initially-hidden-and-main-boundary')
        show(); record('02-show-native-foreground-and-input-focus', True)
        before = snapshot()
        for command, parameters in [
            ('plugin:sql|select', {'db': 'sqlite:todo.db', 'query': 'SELECT 1', 'values': []}),
            ('plugin:sql|execute', {'db': 'sqlite:todo.db', 'query': 'UPDATE tasks SET title=title WHERE 0', 'values': []}),
            ('plugin:sql|load', {'db': 'sqlite:todo.db'}),
            ('plugin:sql|close', {'db': 'sqlite:todo.db'}),
            ('database_boot_status', {}), ('show_quick_add', {}),
            ('plugin:window|hide', {'label': 'main'}),
            ('plugin:window|create', {'options': {'label': 'forbidden'}}),
            ('plugin:event|emit', {'event': 'task-created', 'payload': 123}),
        ]:
            denied(command, parameters)
        assert snapshot() == before
        record('03-quick-sql-main-command-and-core-denials', True)
        for title in ['', '  ', 'a\0b', '🦀' * 501]:
            result = invoke('create_quick_task', {'title': title})
            assert result == {'denial': 'INVALID_TITLE'}, result
        assert snapshot() == before
        record('04-rust-title-validation')
        field('保留草稿'); key('\ue00c'); hidden()
        show(); assert session.script("return document.querySelector('#quick-title').value") == '保留草稿'
        assert quick_state()['hwnd'] == initial_hwnd
        show()  # Showing the already visible window must also reuse the same instance.
        assert quick_state()['hwnd'] == initial_hwnd and len(session.call('GET', '/window/handles')) == 2
        record('05-escape-retains-draft-and-reuses-window', True)
        hwnd = quick_state()['hwnd']
        assert user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE, only this test-owned HWND.
        hidden(); show(); assert quick_state()['hwnd'] == hwnd
        assert session.script("return document.querySelector('#quick-title').value") == '保留草稿'
        record('06-native-close-hides-without-destroying', True)
        field('IME 任务')
        session.script("const input=document.querySelector('#quick-title'); input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'任务'})); input.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',isComposing:true})); document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));")
        assert snapshot() == before and quick_state()['visible']
        session.script("document.querySelector('#quick-title').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'任务'}))")
        key('\ue007'); hidden()
        wait(lambda: len(snapshot()['tasks']) == 1)
        assert snapshot()['tasks'][0]['title'] == 'IME 任务'
        switch(session.main_handle)
        wait(lambda: 'IME 任务' in session.text())
        assert session.script('return window.__createdIds') == [snapshot()['tasks'][0]['id']]
        row = snapshot()['tasks'][0]
        assert row['list_id'] is None and row['notes'] == '' and row['status'] == 'todo' and row['due_at'] is None
        assert row['created_at'] == row['updated_at'] and len(row['created_at']) == 24 and row['created_at'].endswith('Z')
        record('07-ime-enter-create-commit-event-and-main-refresh', True)
        show(); assert session.script("return document.querySelector('#quick-title').value") == ''
        field('Exactly once')
        with sqlite3.connect(DB, timeout=1, isolation_level=None) as lock:
            lock.execute('BEGIN IMMEDIATE')
            session.script("const form=document.querySelector('form'); form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));")
            wait(lambda: session.script("return document.querySelector('#quick-title').disabled"))
            assert len(snapshot()['tasks']) == 1
            lock.execute('ROLLBACK')
        hidden(); wait(lambda: len(snapshot()['tasks']) == 2)
        assert sum(row['title'] == 'Exactly once' for row in snapshot()['tasks']) == 1
        switch(session.main_handle); wait(lambda: 'Exactly once' in session.text())
        record('08-pending-double-submit-one-committed-row', True)
        show(); field('Failure retained')
        with sqlite3.connect(DB, timeout=1, isolation_level=None) as lock:
            lock.execute('BEGIN IMMEDIATE'); key('\ue007')
            wait(lambda: '创建失败，输入已保留。请重试。' in session.text(), timeout=12)
            assert session.script("return document.querySelector('#quick-title').value") == 'Failure retained'
            assert len(snapshot()['tasks']) == 2 and quick_state()['visible']
            lock.execute('ROLLBACK')
        record('09-real-write-failure-retains-draft', True)
        key('\ue00c'); hidden()
        previous = snapshot(); old_pid = session.pid; session.close(); session = start()
        assert session.pid != old_pid and snapshot() == previous and not quick_state()['visible']
        wait(lambda: 'Exactly once' in session.text() and 'IME 任务' in session.text())
        record('10-new-process-persistence-and-hidden-start', True)
        # Cleanup only through rendered Main deletion UI.
        for row in previous['tasks']:
            session.click('[aria-label=' + json.dumps('删除：' + row['title'], ensure_ascii=False) + ']')
            button = wait(lambda: session.script("return Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='永久删除')"))
            session.call('POST', f"/element/{button[ELEMENT]}/click", {})
            wait(lambda: not any(task['id'] == row['id'] for task in snapshot()['tasks']))
        record('11-main-delete-cleanup', True)
        report['gate'] = 'PASS'
    except Exception as error:
        report.update(gate='FAIL', error=str(error))
        if session:
            report['failed_ui'] = session.text()
            session.screenshot('failure')
        raise
    finally:
        if session:
            session.close()
        driver.terminate(); driver.wait(timeout=10); log.close()
        (evidence / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print('EVIDENCE ' + str(evidence), flush=True)


if __name__ == '__main__':
    main()
