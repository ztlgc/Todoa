"""STEP 8: drive the real isolated Tauri executable through Windows WebDriver.

Build with tauri.step8-test.conf.json before running. No production database is opened.
Uses only Python's standard library; UI writes always go through the rendered app.
"""
import argparse
import base64
import csv
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DB = Path(os.environ["APPDATA"]) / "com.todoa.desktop.test.step8" / "todo.db"
ELEMENT = "element-6066-11e4-a52e-4f735466cecf"
HIDDEN = subprocess.CREATE_NO_WINDOW


def wait(check, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError("Condition did not become true before timeout")


def app_pids():
    output = subprocess.check_output(
        ["tasklist", "/FI", "IMAGENAME eq todoa.exe", "/FO", "CSV", "/NH"],
        creationflags=HIDDEN,
    ).decode("utf-8", errors="replace")
    return {int(row[1]) for row in csv.reader(io.StringIO(output)) if row and row[0].lower() == "todoa.exe"}


def database_snapshot():
    with sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True) as db:
        return {
            "schema": db.execute("PRAGMA user_version").fetchone()[0],
            "application_id": db.execute("PRAGMA application_id").fetchone()[0],
            "migration_count": db.execute("SELECT count(*) FROM _sqlx_migrations WHERE version=1 AND success=1").fetchone()[0],
            "tasks": db.execute("SELECT id,title,status,completed_at,list_id FROM tasks ORDER BY sort_order,id").fetchall(),
        }


class NativeSession:
    def __init__(self, application, port, evidence, expected_identifier="com.todoa.desktop.test.step8"):
        self.base = f"http://127.0.0.1:{port}"
        self.session = None
        self.pid = None
        self.evidence = evidence
        before = app_pids()
        if before:
            raise RuntimeError("Close existing Todoa processes before this isolated test")
        result = self.request("POST", "/session", {"capabilities": {"alwaysMatch": {
            "tauri:options": {"application": str(application)},
        }}})
        self.session = result["sessionId"]
        self.capabilities = result["capabilities"]
        try:
            self.pid = wait(lambda: next(iter(app_pids() - before), None))
            for handle in self.call("GET", "/window/handles"):
                self.call("POST", "/window", {"handle": handle})
                if self.script("return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label") == "main":
                    self.main_handle = handle
                    break
            else:
                raise AssertionError("Main WebView was not found")
            self.ready()
            identity = self.call("POST", "/execute/async", {
                "script": "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {db:'sqlite:todo.db',query:'PRAGMA database_list',values:[]}).then(rows => done({rows}), error => done({error:String(error)}));",
                "args": [],
            })
            main_path = next(row["file"] for row in identity["rows"] if row["name"] == "main")
            expected_path = Path(os.environ["APPDATA"]) / expected_identifier / "todo.db"
            assert Path(main_path).resolve() == expected_path.resolve(), "Refusing UI writes outside the expected test database"
            self.identifier = expected_identifier
        except Exception:
            self.close()
            raise

    def request(self, method, path, data=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None
        request = Request(self.base + path, data=body, method=method, headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=60) as response:
                value = json.load(response)["value"]
        except HTTPError as error:
            raise RuntimeError(error.read().decode("utf-8", errors="replace")[:4000]) from error
        if isinstance(value, dict) and "error" in value:
            raise RuntimeError(str(value))
        return value

    def call(self, method, path, data=None):
        return self.request(method, f"/session/{self.session}{path}", data)

    def elements(self, selector):
        return self.call("POST", "/elements", {"using": "css selector", "value": selector})

    def element(self, selector):
        return wait(lambda: (self.elements(selector) or [None])[0])[ELEMENT]

    def script(self, script, *args):
        return self.call("POST", "/execute/sync", {"script": script, "args": list(args)})

    def text(self):
        return self.script("return document.body.innerText")

    def ready(self):
        wait(lambda: self.elements("#task-title") and not self.script("return document.querySelector('#task-title').disabled"))

    def keys(self, text):
        return self.call("POST", f"/element/{self.element('#task-title')}/value", {"text": text})

    def clear(self):
        return self.call("POST", f"/element/{self.element('#task-title')}/clear", {})

    def click(self, selector):
        return self.call("POST", f"/element/{self.element(selector)}/click", {})

    def checked(self, value):
        return self.script("return document.querySelector('[role=checkbox]')?.getAttribute('aria-checked') === arguments[0]", str(value).lower())

    def screenshot(self, name):
        file = self.evidence / f"{name}.png"
        file.write_bytes(base64.b64decode(self.call("GET", "/screenshot")))
        return str(file)

    def close(self):
        if self.session:
            try:
                self.call("DELETE", "")
            finally:
                self.session = None
                if self.pid in app_pids():
                    # Only the PID launched by this session is eligible for termination.
                    subprocess.run(["taskkill", "/PID", str(self.pid), "/T", "/F"], creationflags=HIDDEN, capture_output=True, check=True)
                wait(lambda: self.pid not in app_pids())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--native-driver", type=Path, required=True)
    parser.add_argument("--driver", type=Path, default=Path.home() / ".cargo/bin/tauri-driver.exe")
    parser.add_argument("--application", type=Path, default=ROOT / "src-tauri/target/x86_64-pc-windows-msvc/debug/todoa.exe")
    parser.add_argument("--port", type=int, default=4450)
    args = parser.parse_args()
    stamp = datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%d-%H%M%S")
    evidence = ROOT / "docs/evidence" / f"step8-{stamp}"
    evidence.mkdir(parents=True, exist_ok=False)
    report = {"database": str(DB), "initial_database_exists": DB.exists(), "checks": [], "sessions": []}
    session = None
    log = (evidence / "driver.txt").open("w", encoding="utf-8")
    driver = subprocess.Popen([str(args.driver), "--port", str(args.port), "--native-port", str(args.port + 1), "--native-driver", str(args.native_driver)], stdout=log, stderr=log, creationflags=HIDDEN)

    def record(name, screenshot=False):
        snapshot = database_snapshot()
        assert snapshot["schema"] == 1 and snapshot["application_id"] == 0x57544431 and snapshot["migration_count"] == 1
        entry = {"name": name, "status": "PASS", "sqlite": snapshot, "ui": session.text()}
        if screenshot:
            entry["screenshot"] = session.screenshot(name)
        report["checks"].append(entry)
        print(f"PASS {name}", flush=True)

    def start():
        native = NativeSession(args.application.resolve(), args.port, evidence)
        report["sessions"].append({"pid": native.pid, "identifier": native.identifier, "capabilities": native.capabilities})
        return native

    def restarted():
        nonlocal session
        previous = session.pid
        session.close()
        assert previous not in app_pids()
        session = start()
        assert session.pid != previous

    try:
        def driver_ready():
            try:
                with urlopen(f"http://127.0.0.1:{args.port}/status", timeout=2) as response:
                    return json.load(response)["value"]["ready"]
            except (OSError, KeyError):
                return False
        wait(driver_ready)
        if DB.exists():
            assert database_snapshot()["tasks"] == [], "This test only starts with an empty isolated task database"
        session = start()
        assert "收件箱为空" in session.text()
        assert database_snapshot()["tasks"] == []
        record("01-empty", True)

        session.keys("   \ue007")
        wait(lambda: "任务标题长度" in session.text())
        assert database_snapshot()["tasks"] == []
        record("02-blank-rejected")
        session.clear()
        session.keys("Buy milk\ue007")
        wait(lambda: bool(session.elements('[aria-label="完成：Buy milk"]')))
        wait(lambda: session.script("return document.querySelector('#task-title').value") == "")
        assert database_snapshot()["tasks"][0][1:4] == ("Buy milk", "todo", None)
        record("03-created", True)

        restarted()
        assert session.checked(False)
        assert database_snapshot()["tasks"][0][1:4] == ("Buy milk", "todo", None)
        record("04-create-restart", True)

        session.click('[aria-label="完成：Buy milk"]')
        wait(lambda: session.checked(True))
        complete_time = database_snapshot()["tasks"][0][3]
        assert complete_time
        restarted()
        assert session.checked(True)
        assert database_snapshot()["tasks"][0][2:4] == ("completed", complete_time)
        record("05-complete-restart", True)

        session.click('[aria-label="取消完成：Buy milk"]')
        wait(lambda: session.checked(False))
        restarted()
        assert session.checked(False)
        assert database_snapshot()["tasks"][0][2:4] == ("todo", None)
        record("06-undo-restart", True)

        session.click('[aria-label="删除：Buy milk"]')
        assert "此操作无法撤销" in session.text()
        session.click('[role="group"] button:last-child')
        assert len(database_snapshot()["tasks"]) == 1
        session.click('[aria-label="删除：Buy milk"]')
        session.click('[role="group"] button:first-child')
        wait(lambda: "收件箱为空" in session.text())
        restarted()
        assert "收件箱为空" in session.text() and database_snapshot()["tasks"] == []
        record("07-delete-restart", True)

        session.keys("Keep draft after failure")
        lock = sqlite3.connect(DB)
        try:
            lock.execute("BEGIN IMMEDIATE")
            session.click('form button[type="submit"]')
            wait(lambda: "新增失败，输入已保留" in session.text())
            assert session.script("return document.querySelector('#task-title').value") == "Keep draft after failure"
            assert database_snapshot()["tasks"] == []
            record("08-write-lock-draft", True)
        finally:
            lock.rollback()
            lock.close()
        session.clear()

        # WebDriver controls the actual WebView2 network, not just Query's online flag.
        session.call("POST", "/ms/cdp/execute", {"cmd": "Network.enable", "params": {}})
        session.call("POST", "/ms/cdp/execute", {"cmd": "Network.emulateNetworkConditions", "params": {
            "offline": True, "latency": 0, "downloadThroughput": 0, "uploadThroughput": 0,
        }})
        assert session.script("return navigator.onLine") is False
        session.call("POST", "/refresh", {})
        session.ready()
        assert session.script("return navigator.onLine") is False
        session.keys("Offline task\ue007")
        wait(lambda: bool(session.elements('[aria-label="完成：Offline task"]')))
        session.click('[aria-label="完成：Offline task"]')
        wait(lambda: session.checked(True))
        session.click('[aria-label="取消完成：Offline task"]')
        wait(lambda: session.checked(False))
        session.click('[aria-label="删除：Offline task"]')
        session.click('[role="group"] button:first-child')
        wait(lambda: "收件箱为空" in session.text())
        record("09-offline-reload-crud", True)
        assert database_snapshot()["tasks"] == []
        report["gate"] = "PASS"
    except Exception as error:
        report["gate"] = "FAIL"
        report["error"] = str(error)
        if session:
            report["failed_ui"] = session.text()
        raise
    finally:
        if session:
            session.close()
        driver.terminate()
        driver.wait(timeout=10)
        log.close()
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"EVIDENCE {evidence}", flush=True)


if __name__ == "__main__":
    main()
