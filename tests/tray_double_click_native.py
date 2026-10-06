"""Check the real Windows Shell tray icon while an installed Todoa may be open."""

import ctypes
from ctypes import wintypes
from datetime import datetime
import json
from pathlib import Path
import subprocess
import time

from PIL import ImageGrab

from step8_native import HIDDEN, wait
from step12_native import native_windows
from step15_native import GUID, IconIdentifier, owned_windows, shell32, user32


ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / "src-tauri/target/x86_64-pc-windows-msvc/debug/todoa.exe"


def main() -> None:
    evidence = ROOT / "docs/evidence" / ("tray-double-click-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    evidence.mkdir()
    report = {"identifier": "com.todoa.desktop.test.step15", "checks": []}
    process = subprocess.Popen([str(EXE)], creationflags=HIDDEN)

    def window():
        return next((w for w in native_windows(process.pid) if w["title"] == "Todoa"), None)

    def icon_rect():
        hwnds = owned_windows(process.pid, "tray_icon_app")
        assert len(hwnds) == 1, hwnds
        for icon_id in range(1, 17):
            key = IconIdentifier(ctypes.sizeof(IconIdentifier), hwnds[0], icon_id, GUID())
            rect = wintypes.RECT()
            if shell32.Shell_NotifyIconGetRect(ctypes.byref(key), ctypes.byref(rect)) == 0:
                return rect
        raise AssertionError("Tray icon is not visible in the Shell")

    def visible_icon():
        tray = user32.FindWindowW("Shell_TrayWnd", None)
        notify = user32.FindWindowExW(tray, None, "TrayNotifyWnd", None)
        chevron = user32.FindWindowExW(notify, None, "Button", None)
        overflow = user32.FindWindowW("NotifyIconOverflowWindow", None)
        if chevron and (not overflow or not user32.IsWindowVisible(overflow)):
            user32.SendMessageW(chevron, 0x00F5, 0, 0)
            time.sleep(0.2)
        return icon_rect()

    def click(x, y, right=False):
        user32.SetCursorPos(x, y)
        user32.mouse_event(0x8 if right else 0x2, 0, 0, 0, 0)
        user32.mouse_event(0x10 if right else 0x4, 0, 0, 0, 0)

    try:
        wait(lambda: window() and window()["visible"] and owned_windows(process.pid, "tray_icon_app"), timeout=30)
        assert process.poll() is None
        report["checks"].append("isolated application and Shell tray are running")
        user32.PostMessageW(window()["hwnd"], 0x0010, 0, 0)
        wait(lambda: window() and not window()["visible"])
        rect = visible_icon()
        ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom)).save(evidence / "tray-icon.png")
        x, y = (rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2
        click(x, y)
        time.sleep(0.08)
        click(x, y)
        wait(lambda: window() and window()["visible"] and window()["foreground"])
        report["checks"].append("physical left double click restored and focused Main")

        rect = visible_icon()
        click((rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2, right=True)
        popup = wait(lambda: (owned_windows(process.pid, "#32768") or [None])[0])
        menu = user32.SendMessageW(popup, 0x01E1, 0, 0)
        assert user32.GetMenuItemCount(menu) == 3
        item = wintypes.RECT()
        assert user32.GetMenuItemRect(None, menu, 2, ctypes.byref(item))
        click((item.left + item.right) // 2, (item.top + item.bottom) // 2)
        process.wait(timeout=20)
        report["checks"].append("Quit menu exited the isolated process")
        report["gate"] = "PASS"
    except Exception as error:
        report.update(gate="FAIL", error=str(error))
        raise
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("EVIDENCE " + str(evidence), flush=True)


if __name__ == "__main__":
    main()
