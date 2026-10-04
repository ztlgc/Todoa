"""Attached WebView2 sessions with normal native tray quit, for isolated tests."""
import sys
sys.dont_write_bytecode=True
import ctypes,json,os,socket,subprocess,time
from pathlib import Path
from urllib.request import urlopen
from step8_native import NativeSession,HIDDEN,wait,app_pids,ELEMENT
from step12_native import native_windows
from step15_native import user32,owned_windows,shell32,IconIdentifier,wintypes

def free_port():
    with socket.socket()as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

class Harness:
    def __init__(self,binary,identifier,native_driver,evidence):
        assert identifier.startswith('com.todoa.desktop.test.')
        self.binary=Path(binary);self.identifier=identifier;self.driver_path=native_driver;self.evidence=evidence
        self.driver=None;self.session=None;self.app=None;self.cdp=free_port();self.log=(evidence/'driver.txt').open('w',encoding='utf-8')
        self.env=os.environ.copy();self.env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']=f'--remote-debugging-port={self.cdp}'
    def start(self,args=[]):
        assert not app_pids()
        self.app=subprocess.Popen([str(self.binary),*args],env=self.env,creationflags=HIDDEN,stdout=self.log,stderr=self.log)
        wait(lambda:self.app.pid in app_pids());self.attach(self.app.pid)
        return self.session
    def attach(self,pid):
        self.stop_driver();port=free_port()
        self.driver=subprocess.Popen([str(self.driver_path),'--port='+str(port)],creationflags=HIDDEN,stdout=self.log,stderr=self.log)
        def driver_ready():
            try:return json.load(urlopen(f'http://127.0.0.1:{port}/status',timeout=2))['value']['ready']
            except Exception:return False
        wait(driver_ready)
        session=NativeSession.__new__(NativeSession);session.base=f'http://127.0.0.1:{port}';session.session=None;session.pid=pid;session.evidence=self.evidence;session.identifier=self.identifier
        value=session.request('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'webview2','ms:edgeOptions':{'debuggerAddress':f'localhost:{self.cdp}'}}}});session.session=value['sessionId'];self.session=session
        def select_main():
            for handle in session.call('GET','/window/handles'):
                session.call('POST','/window',{'handle':handle})
                if session.script('return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label')=='main':session.main_handle=handle;return True
            return False
        wait(select_main);session.ready()
        rows=self.invoke('plugin:sql|select',{'db':'sqlite:todo.db','query':'PRAGMA database_list','values':[]})['value']
        actual=Path(next(row['file']for row in rows if row['name']=='main')).resolve()
        assert actual==(Path(os.environ['APPDATA'])/self.identifier/'todo.db').resolve(),'Refuse data writes outside dedicated test DB'
    def invoke(self,command,arguments=None):
        return self.session.call('POST','/execute/async',{'script':"const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({denial:String(error)}));",'args':[command,arguments or {}]})
    def button(self,text):
        element=wait(lambda:self.session.script("return [...document.querySelectorAll('button')].find(b=>b.textContent.trim()===arguments[0])",text));self.session.call('POST',f'/element/{element[ELEMENT]}/click',{})
    def main_window(self):return next(w for w in native_windows(self.session.pid)if w['title']=='Todoa')
    def click_menu(self,label):
        pid=self.session.pid;hwnd=wait(lambda:(owned_windows(pid,'tray_icon_app')or[None])[0]);rect=wintypes.RECT()
        def icon():
            for id in range(1,17):
                ident=IconIdentifier(ctypes.sizeof(IconIdentifier),hwnd,id)
                if shell32.Shell_NotifyIconGetRect(ctypes.byref(ident),ctypes.byref(rect))>=0 and rect.right>rect.left and rect.bottom>rect.top:return True
            return False
        assert icon()
        tray=user32.FindWindowW('Shell_TrayWnd',None);notify=user32.FindWindowExW(tray,None,'TrayNotifyWnd',None);chevron=user32.FindWindowExW(notify,None,'Button',None);overflow=user32.FindWindowW('NotifyIconOverflowWindow',None)
        if chevron and(not overflow or not user32.IsWindowVisible(overflow)):user32.SendMessageW(chevron,0x00F5,0,0);time.sleep(.2)
        assert icon();self.click_point((rect.left+rect.right)//2,(rect.top+rect.bottom)//2,True)
        popup=wait(lambda:(owned_windows(pid,'#32768')or[None])[0]);menu=user32.SendMessageW(popup,0x01E1,0,0);labels=[]
        for i in range(user32.GetMenuItemCount(menu)):
            text=ctypes.create_unicode_buffer(128);user32.GetMenuStringW(menu,i,text,128,0x400);labels.append(text.value)
        assert labels==['显示主窗口','快速添加','退出'];item=wintypes.RECT();assert user32.GetMenuItemRect(None,menu,labels.index(label),ctypes.byref(item));time.sleep(.2);self.click_point((item.left+item.right)//2,(item.top+item.bottom)//2)
    def click_point(self,x,y,right=False):
        user32.SetCursorPos(x,y);user32.mouse_event(8 if right else 2,0,0,0,0);user32.mouse_event(16 if right else 4,0,0,0,0)
    def quit(self):
        pid=self.session.pid
        if self.invoke('lifecycle_status').get('value')=='tray-ready':self.click_menu('退出')
        else:user32.PostMessageW(self.main_window()['hwnd'],0x0010,0,0)
        wait(lambda:pid not in app_pids(),20);assert not app_pids()
        assert user32.RegisterHotKey(None,1691,0x4006,0x20);user32.UnregisterHotKey(None,1691)
        self.session=None;self.stop_driver()
    def stop_driver(self):
        if self.driver:
            subprocess.run(['taskkill','/PID',str(self.driver.pid),'/T','/F'],capture_output=True,creationflags=HIDDEN);self.driver.wait();self.driver=None
    def close(self):
        if self.session and self.session.pid in app_pids():
            # Cleanup only, never counted as a tested normal exit.
            subprocess.run(['taskkill','/PID',str(self.session.pid),'/T','/F'],capture_output=True,creationflags=HIDDEN)
        self.stop_driver();self.log.close()
