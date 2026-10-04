"""Actual window geometry + isolated Windows Run registration and startup arguments."""
import sys
sys.dont_write_bytecode=True
import argparse,ctypes,json,os,shutil,subprocess,time,winreg
from pathlib import Path
from datetime import datetime
from native_support import Harness,HIDDEN,wait,app_pids,user32,native_windows,wintypes

ROOT=Path(__file__).resolve().parents[1];IDENTIFIER='com.todoa.desktop.test.step19';ENTRY=f'TodoaTest ({IDENTIFIER})'
RUN=r'SOFTWARE\Microsoft\Windows\CurrentVersion\Run';APPROVED=r'SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
user32.SetWindowPos.argtypes=[wintypes.HWND,wintypes.HWND,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,wintypes.UINT]
user32.GetClientRect.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.RECT)]
user32.IsZoomed.argtypes=[wintypes.HWND];user32.GetDpiForWindow.argtypes=[wintypes.HWND]
def run_value(root=winreg.HKEY_CURRENT_USER):
    try:
        with winreg.OpenKey(root,RUN)as key:return winreg.QueryValueEx(key,ENTRY)[0]
    except FileNotFoundError:return None
def rect(hwnd):
    r=wintypes.RECT();assert user32.GetWindowRect(hwnd,ctypes.byref(r));return [r.left,r.top,r.right-r.left,r.bottom-r.top]

def main():
    p=argparse.ArgumentParser();p.add_argument('--native-driver',type=Path,required=True);args=p.parse_args()
    assert not app_pids();assert run_value()is None and run_value(winreg.HKEY_LOCAL_MACHINE)is None,'Existing OS registration; refusing to modify it'
    evidence=ROOT/'docs/evidence'/('step19-'+datetime.now().strftime('%Y%m%d-%H%M%S'));evidence.mkdir()
    # Preserve the test executable at a path containing spaces to test Run quoting.
    appdir=ROOT/'.local-test-data'/evidence.name/'app with spaces';appdir.mkdir(parents=True);binary=appdir/'todoa.exe';shutil.copy2(ROOT/'src-tauri/target/debug/todoa.exe',binary)
    h=Harness(binary,IDENTIFIER,args.native_driver,evidence);report={'identifier':IDENTIFIER,'checks':[],'denials':[],'real_login':'STEP22 pending','physical_dpi_change':'STEP22 pending'}
    state=Path(os.environ['APPDATA'])/IDENTIFIER/'.window-state.json'
    def record(name,shot=False):
        report['checks'].append({'name':name,'status':'PASS','window':h.main_window(),'rect':rect(h.main_window()['hwnd'])})
        if shot:h.session.screenshot(name)
        print('PASS '+name,flush=True)
    try:
        h.start();wait(lambda:h.main_window()['visible']);main=h.main_window();assert not user32.IsIconic(main['hwnd']);assert h.invoke('autostart_status')=={'value':False};wait(lambda:'系统实际状态：已关闭'in h.session.text());record('01-manual-visible-default-autostart-off',True)
        h.session.click('[role="checkbox"]');wait(lambda:'系统实际状态：已启用'in h.session.text());command=run_value();assert command==f'"{binary}" --autostart',command;assert run_value(winreg.HKEY_LOCAL_MACHINE)is None;report['run_command']=command;record('02-real-hkcu-enable-quoted-space-path',True)
        # A real Task Manager override in this dedicated application's registry value.
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER,APPROVED)as key:winreg.SetValueEx(key,ENTRY,0,winreg.REG_BINARY,bytes([3,0,0,0,1,0,0,0,0,0,0,0]))
        h.button('刷新系统状态');wait(lambda:'系统实际状态：已关闭'in h.session.text());assert run_value()is not None;record('03-os-disabled-override-reflected')
        assert h.invoke('set_autostart',{'enabled':True})=={'value':True};h.button('刷新系统状态');wait(lambda:'系统实际状态：已启用'in h.session.text())
        hwnd=h.main_window()['hwnd'];assert user32.SetWindowPos(hwnd,None,140,120,960,680,0x14);wait(lambda:rect(hwnd)==[140,120,960,680]);report['dpi']=user32.GetDpiForWindow(hwnd);time.sleep(.5);h.quit()
        saved=json.loads(state.read_text(encoding='utf-8'));assert set(saved)=={'main'};assert not saved['main']['maximized'];report['saved_state']=saved
        h.start();assert h.main_window()['visible'];assert rect(h.main_window()['hwnd'])==[140,120,960,680];record('04-position-size-physical-pixels-restart',True)
        user32.ShowWindow(h.main_window()['hwnd'],3);wait(lambda:user32.IsZoomed(h.main_window()['hwnd']));h.quit();assert json.loads(state.read_text(encoding='utf-8'))['main']['maximized']
        h.start();wait(lambda:user32.IsZoomed(h.main_window()['hwnd']));assert h.main_window()['visible'];record('05-maximized-restart-manual-shown',True)
        user32.ShowWindow(h.main_window()['hwnd'],9);user32.ShowWindow(h.main_window()['hwnd'],6);assert user32.IsIconic(h.main_window()['hwnd']);h.quit()
        h.start();assert h.main_window()['visible']and not user32.IsIconic(h.main_window()['hwnd']);record('06-minimized-not-restored');h.quit()
        saved=json.loads(state.read_text(encoding='utf-8'));saved['main'].update(x=50000,y=50000,prev_x=50000,prev_y=50000,maximized=False,visible=False);state.write_text(json.dumps(saved),encoding='utf-8')
        h.start();assert h.main_window()['visible'];assert abs(rect(h.main_window()['hwnd'])[0])<50000;record('07-removed-monitor-persisted-position-repaired',True)
        hwnd=h.main_window()['hwnd'];user32.SetWindowPos(hwnd,None,50000,50000,800,600,0x14);wait(lambda:abs(rect(hwnd)[0])<50000,10);record('08-live-offscreen-repaired-without-showing-quick');h.quit()
        h.start(['--autostart']);status=h.invoke('lifecycle_status')['value']
        assert status=='tray-ready', 'Background startup must be tested with an actual tray'
        assert not h.main_window()['visible']
        report['autostart_tray_status']=status;assert h.invoke('database_boot_status')=={'value':1};record('09-real-tray-autostart-background-database-ready')
        pid=h.session.pid;secondary=subprocess.Popen([str(binary),'--autostart'],creationflags=HIDDEN,stdout=h.log,stderr=h.log);secondary.wait(timeout=10);assert app_pids()=={pid}
        if status=='tray-ready':assert not h.main_window()['visible']
        record('10-secondary-autostart-no-second-process-no-wake')
        secondary=subprocess.Popen([str(binary)],creationflags=HIDDEN,stdout=h.log,stderr=h.log);secondary.wait(timeout=10);wait(lambda:h.main_window()['visible']);assert app_pids()=={pid};record('11-secondary-manual-wakes-main',True)
        assert h.invoke('set_autostart',{'enabled':False})=={'value':False};h.button('刷新系统状态');wait(lambda:'系统实际状态：已关闭'in h.session.text());assert run_value()is None;record('12-real-autostart-disabled')
        h.invoke('show_quick_add')
        def select_quick():
            for handle in h.session.call('GET','/window/handles'):
                h.session.call('POST','/window',{'handle':handle})
                if h.session.script('return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label')=='quick-add':return True
            return False
        wait(select_quick)
        for cmd in ['autostart_status','set_autostart','plugin:autostart|enable','plugin:window-state|save_window_state']:
            denial=h.invoke(cmd,{'enabled':True});assert 'denial'in denial;report['denials'].append({'command':cmd,**denial})
        h.session.call('POST','/window',{'handle':h.session.main_handle});h.quit();report['normal_exit']=True;report['status']='PASS'
    except Exception as error:
        report['status']='FAIL';report['error']=repr(error)
        if h.session:
            try:report['body']=h.session.text();h.session.screenshot('failure')
            except Exception:pass
        raise
    finally:
        # Remove only the exact isolated Run entry through the app before normal exit;
        # preserve failed registration for diagnosis if that cannot be reached.
        if run_value()is None:
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER,APPROVED,0,winreg.KEY_SET_VALUE)as key:winreg.DeleteValue(key,ENTRY)
            except FileNotFoundError:pass
        (evidence/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(evidence/'report.json');h.close()

if __name__=='__main__':main()
