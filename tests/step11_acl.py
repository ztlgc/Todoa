"""Exercise the production Main ACL and a capability-less test WebView."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime
from urllib.request import urlopen

sys.dont_write_bytecode = True
from step8_native import NativeSession, HIDDEN, wait

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--native-driver', type=Path, required=True)
    args = parser.parse_args()
    evidence = ROOT / 'docs/evidence' / ('step11-acl-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
    evidence.mkdir()
    report = {'checks': []}
    log = (evidence / 'driver.txt').open('w', encoding='utf-8')
    driver = subprocess.Popen([str(Path.home() / '.cargo/bin/tauri-driver.exe'), '--port', '4480', '--native-port', '4481', '--native-driver', str(args.native_driver)], stdout=log, stderr=log, creationflags=HIDDEN)
    session = None
    try:
        def ready():
            try:
                return json.load(urlopen('http://127.0.0.1:4480/status', timeout=2))['value']['ready']
            except Exception:
                return False
        wait(ready)
        session = NativeSession(ROOT / 'src-tauri/target/x86_64-pc-windows-msvc/debug/todoa.exe', 4480, evidence, 'com.todoa.desktop.test.step11')

        def invoke(command, arguments):
            return session.call('POST', '/execute/async', {'script': "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({denial:String(error)}));", 'args': [command, arguments]})

        def denied(command, arguments):
            result = invoke(command, arguments)
            assert 'denial' in result and ('not allowed' in result['denial'].lower() or 'not permitted' in result['denial'].lower()), result
            report['checks'].append({'window': session.script('return window.__TAURI_INTERNALS__.metadata.currentWindow.label'), 'command': command, 'status': 'PASS', **result})
            print('PASS denied ' + command, flush=True)

        assert invoke('database_boot_status', {}) == {'value': 1}
        for command, arguments in [
            ('plugin:sql|load', {'db': 'sqlite:todo.db'}),
            ('plugin:sql|close', {'db': 'sqlite:todo.db'}),
            ('plugin:app|identifier', {}),
            ('plugin:window|hide', {'label': 'main'}),
            ('plugin:event|emit', {'event': 'acl-test', 'payload': None}),
            ('plugin:event|emit_to', {'target': {'kind': 'AnyLabel', 'label': 'main'}, 'event': 'acl-test', 'payload': None}),
        ]:
            denied(command, arguments)
        session.screenshot('main-ready')
        for handle in session.call('GET', '/window/handles'):
            session.call('POST', '/window', {'handle': handle})
            if session.script('return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label') == 'acl-probe':
                break
        else:
            raise AssertionError('ACL probe not found')
        denied('database_boot_status', {})
        denied('plugin:sql|select', {'db': 'sqlite:todo.db', 'query': 'SELECT 1', 'values': []})
        denied('plugin:sql|execute', {'db': 'sqlite:todo.db', 'query': 'UPDATE tasks SET title=title WHERE 0', 'values': []})
        session.screenshot('probe-denied')
        session.call('POST', '/window', {'handle': session.main_handle})
        session.ready()
        assert invoke('database_boot_status', {}) == {'value': 1}
        report['gate'] = 'PASS'
    except Exception as error:
        report.update(gate='FAIL', error=str(error))
        raise
    finally:
        if session:
            session.close()
        driver.terminate()
        driver.wait(timeout=10)
        log.close()
        (evidence / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print('EVIDENCE ' + str(evidence), flush=True)


if __name__ == '__main__':
    main()
