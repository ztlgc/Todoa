"""Real Windows input-method probe in the existing dedicated STEP20 DB only."""
import sys
sys.dont_write_bytecode=True
import argparse,ctypes,json,time
from pathlib import Path
from datetime import datetime
from native_support import Harness,wait,app_pids,user32,wintypes
from step15_native import ImageGrab
ROOT=Path(__file__).resolve().parents[1]
class GuiInfo(ctypes.Structure):
    _fields_=[('size',wintypes.DWORD),('flags',wintypes.DWORD),('active',wintypes.HWND),('focus',wintypes.HWND),('capture',wintypes.HWND),('menu',wintypes.HWND),('move',wintypes.HWND),('caret',wintypes.HWND),('rect',wintypes.RECT)]
class Key(ctypes.Structure):_fields_=[('vk',wintypes.WORD),('scan',wintypes.WORD),('flags',wintypes.DWORD),('time',wintypes.DWORD),('extra',ctypes.c_size_t)]
class Mouse(ctypes.Structure):_fields_=[('dx',wintypes.LONG),('dy',wintypes.LONG),('data',wintypes.DWORD),('flags',wintypes.DWORD),('time',wintypes.DWORD),('extra',ctypes.c_size_t)]
class InputUnion(ctypes.Union):_fields_=[('key',Key),('mouse',Mouse)]
class Input(ctypes.Structure):_fields_=[('type',wintypes.DWORD),('union',InputUnion)]
user32.GetGUIThreadInfo.argtypes=[wintypes.DWORD,ctypes.POINTER(GuiInfo)];user32.GetKeyboardLayout.argtypes=[wintypes.DWORD];user32.GetKeyboardLayout.restype=wintypes.HANDLE
user32.SendInput.argtypes=[wintypes.UINT,ctypes.POINTER(Input),ctypes.c_int];user32.SetForegroundWindow.argtypes=[wintypes.HWND]
imm=ctypes.WinDLL('imm32');imm.ImmGetContext.argtypes=[wintypes.HWND];imm.ImmGetContext.restype=wintypes.HANDLE;imm.ImmGetOpenStatus.argtypes=[wintypes.HANDLE];imm.ImmSetOpenStatus.argtypes=[wintypes.HANDLE,wintypes.BOOL];imm.ImmGetConversionStatus.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD),ctypes.POINTER(wintypes.DWORD)];imm.ImmSetConversionStatus.argtypes=[wintypes.HANDLE,wintypes.DWORD,wintypes.DWORD];imm.ImmReleaseContext.argtypes=[wintypes.HWND,wintypes.HANDLE]
def main():
    p=argparse.ArgumentParser();p.add_argument('--native-driver',type=Path,required=True);args=p.parse_args();assert not app_pids()
    evidence=ROOT/'docs/evidence'/('step20-ime-'+datetime.now().strftime('%Y%m%d-%H%M%S'));evidence.mkdir()
    h=Harness(ROOT/'src-tauri/target/debug/todoa.exe','com.todoa.desktop.test.step20',args.native_driver,evidence);report={'status':'PENDING','checks':[]};layout=None;context=None;focus=None;toggled=False
    def sql(query,values=[]):return h.invoke('plugin:sql|select',{'db':'sqlite:todo.db','query':query,'values':values})['value']
    def events():return h.session.script('return window.__imeEvents')
    def send(vk):
        assert int(user32.GetForegroundWindow())==h.main_window()['hwnd'],'Typing target lost foreground; refusing keys'
        data=(Input*2)(Input(1,InputUnion(key=Key(vk,0,0,0,0))),Input(1,InputUnion(key=Key(vk,0,2,0,0))))
        assert user32.SendInput(2,data,ctypes.sizeof(Input))==2
        time.sleep(.09)
    def letters():
        for letter in 'ZHONGWEN':send(ord(letter))
    def draft():return h.session.script('return document.querySelector("#task-title").value')
    def reset():
        elem=h.session.element('#task-title');h.session.call('POST',f'/element/{elem}/clear',{});h.session.call('POST',f'/element/{elem}/value',{'text':'S20 '});h.session.click('#task-title')
    try:
        h.start();base=sql('SELECT id,title FROM tasks');baseline={row['id']for row in base}
        h.session.script("window.__imeEvents=[];const i=document.querySelector('#task-title');for(const type of ['compositionstart','compositionupdate','compositionend','keydown','keyup','input'])i.addEventListener(type,e=>window.__imeEvents.push({type:e.type,key:e.key,code:e.code,keyCode:e.keyCode,isComposing:e.isComposing,isTrusted:e.isTrusted,data:e.data,value:i.value}));")
        reset();user32.SetForegroundWindow(h.main_window()['hwnd']);wait(lambda:h.main_window()['foreground'])
        info=GuiInfo();info.size=ctypes.sizeof(info);assert user32.GetGUIThreadInfo(0,ctypes.byref(info));focus=int(info.focus);pid=wintypes.DWORD();thread=user32.GetWindowThreadProcessId(focus,ctypes.byref(pid));layout=int(user32.GetKeyboardLayout(thread));report['original_layout']=hex(layout);report['focused_hwnd']=focus;report['input_thread_pid']=pid.value
        user32.PostMessageW(focus,0x0050,1,0x08040804);time.sleep(.3);report['selected_layout']=hex(int(user32.GetKeyboardLayout(thread)))
        context=imm.ImmGetContext(focus);report['ime_context']=int(context or 0)
        if context:
            opened=imm.ImmGetOpenStatus(context);conv=wintypes.DWORD();sentence=wintypes.DWORD();imm.ImmGetConversionStatus(context,ctypes.byref(conv),ctypes.byref(sentence));report['original_ime']={'open':opened,'conversion':conv.value,'sentence':sentence.value};imm.ImmSetOpenStatus(context,True);imm.ImmSetConversionStatus(context,conv.value|1,sentence.value)
        letters();time.sleep(.3)
        if not any(e['type']=='compositionstart'and e['isTrusted']for e in events()):
            # Some modern TSF profiles toggle Chinese/English through Shift.
            reset();send(0x10);toggled=True;report['shift_mode_toggled']=True;letters();time.sleep(.3)
        if not any(e['type']=='compositionstart'and e['isTrusted']for e in events()):
            report['status']='UNVERIFIED';report['reason']='Installed Chinese layout did not produce trusted IME composition through this desktop session';print(report['reason']);return
        r=wintypes.RECT();user32.GetWindowRect(h.main_window()['hwnd'],ctypes.byref(r));ImageGrab.grab(bbox=(r.left,r.top,r.right,r.bottom)).save(evidence/'real-ime-composition.png')
        send(0x0D);time.sleep(.5);assert {row['id']for row in sql('SELECT id FROM tasks')}==baseline,'IME confirmation Enter submitted a task'
        report['checks'].append({'name':'real-trusted-ime-enter-confirms-composition-without-submitting','status':'PASS','value':draft()})
        reset();letters();send(0x20);wait(lambda:any('\u4e00'<=c<='\u9fff'for c in draft()));value=draft();report['chinese_value']=value
        send(0x0D);created=wait(lambda:[row for row in sql('SELECT id,title FROM tasks')if row['id']not in baseline]);assert len(created)==1 and created[0]['title']==value.strip(),created
        taskid=created[0]['id'];wait(lambda:h.session.elements(f'li[data-task-id="{taskid}"]'));h.session.click(f'li[data-task-id="{taskid}"] button[aria-label^="删除："]');h.button('永久删除');wait(lambda:{row['id']for row in sql('SELECT id FROM tasks')}==baseline)
        report['checks'].append({'name':'real-chinese-candidate-space-then-separate-enter-creates-once-and-ui-cleanup','status':'PASS'});report['status']='PASS'
    except Exception as error:report['status']='FAIL';report['error']=repr(error);raise
    finally:
        if h.session:
            try:
                report['events']=events()
                if context:
                    old=report.get('original_ime',{});imm.ImmSetOpenStatus(context,old.get('open',False));imm.ImmSetConversionStatus(context,old.get('conversion',0),old.get('sentence',0));imm.ImmReleaseContext(focus,context)
                if toggled:send(0x10)
                if focus and layout:
                    user32.PostMessageW(focus,0x0050,1,layout);time.sleep(.15);report['restored_layout']=hex(int(user32.GetKeyboardLayout(thread)));assert int(user32.GetKeyboardLayout(thread))==layout
                if h.session.pid in app_pids():
                    h.session.call('POST',f'/element/{h.session.element("#task-title")}/clear',{});h.quit();report['normal_exit']=True
            except Exception as error:report['cleanup_error']=repr(error)
        (evidence/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(evidence/'report.json',flush=True);h.close()
if __name__=='__main__':main()
