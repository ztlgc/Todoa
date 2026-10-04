"""STEP 9 real Windows Tauri UI, foreign keys, write failures and process restarts.

Build with tauri.step9-test.conf.json. Business writes use rendered React handlers;
Python only snapshots the isolated DB and holds a synthetic write lock.
"""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from urllib.request import urlopen

sys.dont_write_bytecode = True
from step8_native import NativeSession, HIDDEN, ELEMENT, app_pids, wait

ROOT = Path(__file__).resolve().parents[1]
IDENTIFIER = "com.todoa.desktop.test.step9"
DB = Path(os.environ["APPDATA"]) / IDENTIFIER / "todo.db"


def snapshot():
    with sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        return {
            "schema": db.execute("PRAGMA user_version").fetchone()[0],
            "migration_count": db.execute("SELECT count(*) FROM _sqlx_migrations WHERE version=1 AND success=1").fetchone()[0],
            "foreign_key_check": [list(row) for row in db.execute("PRAGMA foreign_key_check")],
            "lists": [dict(row) for row in db.execute("SELECT * FROM lists ORDER BY id")],
            "tasks": [dict(row) for row in db.execute("SELECT * FROM tasks ORDER BY id")],
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--native-driver", type=Path, required=True)
    parser.add_argument("--clean-known-failed-fixture", action="store_true", help="Only clean the exact two-list/two-task fixture from the first failed STEP 9 run, through UI")
    parser.add_argument("--step", type=int, choices=(9, 11), default=9)
    args = parser.parse_args()
    global IDENTIFIER, DB
    IDENTIFIER = f"com.todoa.desktop.test.step{args.step}"
    DB = Path(os.environ["APPDATA"]) / IDENTIFIER / "todo.db"
    stamp = datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%d-%H%M%S")
    evidence = ROOT / "docs/evidence" / f"step{args.step}-lists-{stamp}"
    evidence.mkdir(parents=True, exist_ok=False)
    report = {"database": str(DB), "initial_database_exists": DB.exists(), "checks": [], "sessions": []}
    session = None
    log = (evidence / "driver.txt").open("w", encoding="utf-8")
    port = 4460
    driver = subprocess.Popen([str(Path.home() / ".cargo/bin/tauri-driver.exe"), "--port", str(port), "--native-port", str(port + 1), "--native-driver", str(args.native_driver)], stdout=log, stderr=log, creationflags=HIDDEN)

    def start():
        native = NativeSession(ROOT / "src-tauri/target/x86_64-pc-windows-msvc/debug/todoa.exe", port, evidence, IDENTIFIER)
        wait(lambda: native.script("return !!document.querySelector('#new-list-name') && !document.querySelector('#new-list-name').disabled"))
        report["sessions"].append({"pid": native.pid, "identifier": native.identifier, "capabilities": native.capabilities})
        return native

    def restart():
        nonlocal session
        old = session.pid
        session.close()
        assert old not in app_pids()
        session = start()
        assert session.pid != old

    def field(selector, value):
        element = session.element(selector)
        session.call("POST", f"/element/{element}/clear", {})
        session.call("POST", f"/element/{element}/value", {"text": value})

    def button(label):
        element = wait(lambda: session.script("return Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === arguments[0])", label))
        session.call("POST", f"/element/{element[ELEMENT]}/click", {})

    def open_list(name=None):
        label = f"打开清单：{name}" if name else "打开收件箱"
        session.click(f"button[aria-label={json.dumps(label, ensure_ascii=False)}]")
        wait(lambda: session.script("return document.querySelector('h1')?.textContent === arguments[0]", name or "收件箱"))
        session.ready()

    def create_list(name):
        field("#new-list-name", name + "\ue007")
        wait(lambda: any(row["name"] == name for row in snapshot()["lists"]))
        wait(lambda: session.script("return document.querySelector('h1')?.textContent === arguments[0]", name))
        session.ready()
        return next(row["id"] for row in snapshot()["lists"] if row["name"] == name)

    def create_task(title):
        session.keys(title + "\ue007")
        wait(lambda: session.elements(f"[aria-label={json.dumps('移动任务：' + title, ensure_ascii=False)}]"))
        wait(lambda: session.script("return document.querySelector('#task-title').value === ''"))

    def move(title, target):
        selector = f"select[aria-label={json.dumps('移动任务：' + title, ensure_ascii=False)}]"
        session.click(selector + f" option[value='{target if target is not None else 'inbox'}']")
        wait(lambda: next(row["list_id"] for row in snapshot()["tasks"] if row["title"] == title) == target)
        wait(lambda: not session.elements(selector))

    def record(name, screenshots=True):
        state = snapshot()
        assert state["schema"] == 1 and state["migration_count"] == 1 and state["foreign_key_check"] == []
        assert session.script("return document.querySelectorAll('h1').length") == 1
        entry = {"name": name, "status": "PASS", "sqlite": state, "ui": session.text()}
        if screenshots:
            entry["screenshot"] = session.screenshot(name)
        report["checks"].append(entry)
        print(f"PASS {name}", flush=True)

    def preserved(before, after):
        assert len(before) == len(after)
        for old, new in zip(before, after):
            assert {key: value for key, value in old.items() if key not in ("list_id", "updated_at")} == {key: value for key, value in new.items() if key not in ("list_id", "updated_at")}

    try:
        def driver_ready():
            try:
                with urlopen(f"http://127.0.0.1:{port}/status", timeout=2) as response:
                    return json.load(response)["value"]["ready"]
            except OSError:
                return False
        wait(driver_ready)
        previous = snapshot() if DB.exists() else None
        has_fixture = previous is not None and bool(previous["lists"] or previous["tasks"])
        if has_fixture:
            assert args.clean_known_failed_fixture, "Requires an empty isolated STEP 9 database"
            assert sorted(row["name"] for row in previous["lists"]) == ["个人", "工作"]
            assert sorted(row["title"] for row in previous["tasks"]) == ["Completed task", "Work task"]
            assert all(row["list_id"] == next(item["id"] for item in previous["lists"] if item["name"] == "工作") for row in previous["tasks"])
        session = start()
        if has_fixture:
            for name in ["工作", "个人"]:
                open_list(name)
                button("删除清单")
                button("确认删除清单")
                wait(lambda: not any(row["name"] == name for row in snapshot()["lists"]))
                wait(lambda: session.script("return document.querySelector('h1').textContent === '收件箱'"))
            for task in previous["tasks"]:
                session.click(f"[aria-label={json.dumps('删除：' + task['title'], ensure_ascii=False)}]")
                button("永久删除")
                wait(lambda: not any(row["id"] == task["id"] for row in snapshot()["tasks"]))
            wait(lambda: "收件箱为空" in session.text())
            report["known_failed_fixture_ui_cleanup"] = {"before": previous, "after": snapshot()}
        assert "收件箱为空" in session.text()
        field("#new-list-name", "   \ue007")
        wait(lambda: "清单名称长度" in session.text())
        assert snapshot()["lists"] == []
        record("01-empty-and-blank-list")

        work = create_list("工作")
        create_task("Work task")
        create_task("Completed task")
        session.click('[aria-label="完成：Completed task"]')
        wait(lambda: session.elements('[aria-label="取消完成：Completed task"]'))
        personal = create_list("个人")
        create_task("Personal task")
        button("重命名清单")
        before_name = next(row for row in snapshot()["lists"] if row["id"] == personal)
        field("#rename-list", "个人项目\ue007")
        wait(lambda: session.script("return document.querySelector('h1').textContent === '个人项目'"))
        renamed = next(row for row in snapshot()["lists"] if row["id"] == personal)
        assert renamed["created_at"] == before_name["created_at"] and renamed["updated_at"] > before_name["updated_at"]
        state = snapshot()
        assert [row["list_id"] for row in state["tasks"]] == [work, work, personal]
        record("02-create-in-list-and-rename")
        restart()
        assert snapshot() == state
        open_list("工作")
        assert "Work task" in session.text() and "Completed task" in session.text() and "Personal task" not in session.text()
        open_list("个人项目")
        assert "Personal task" in session.text() and "Work task" not in session.text()
        record("03-create-rename-restart")

        open_list()
        create_task("Inbox task")
        open_list("工作")
        before_move = snapshot()["tasks"]
        move("Work task", personal)
        after_move = snapshot()["tasks"]
        preserved(before_move, after_move)
        assert after_move[0]["updated_at"] > before_move[0]["updated_at"]
        assert "Completed task" in session.text() and "Work task" not in session.text()
        open_list("个人项目")
        assert "Work task" in session.text() and "Personal task" in session.text()
        move("Personal task", None)
        open_list()
        assert "Personal task" in session.text() and "Inbox task" in session.text() and "Work task" not in session.text()
        record("04-move-between-lists-and-inbox")
        state = snapshot()
        restart()
        assert snapshot() == state
        open_list("个人项目")
        assert "Work task" in session.text() and "Personal task" not in session.text()
        record("05-move-restart")

        # An absent positive target cannot normally be selected. Inject only an option,
        # then dispatch the actual UI change handler to exercise Repository + SQL FK.
        before_invalid = snapshot()
        session.script("const field = document.querySelector('select[aria-label=\"移动任务：Work task\"]'); const option = new Option('Missing test list', '999999999'); field.add(option); field.value = option.value; field.dispatchEvent(new Event('change', {bubbles: true}));")
        wait(lambda: "移动失败，任务仍在原清单" in session.text())
        assert snapshot() == before_invalid
        assert session.script("return document.querySelector('select[aria-label=\"移动任务：Work task\"]').value") == str(personal)
        session.script("document.querySelector('option[value=\"999999999\"]').remove()")
        record("06-missing-list-fk-rejected")

        open_list()
        open_list("个人项目")

        before_lock = snapshot()
        lock = sqlite3.connect(DB)
        try:
            lock.execute("BEGIN IMMEDIATE")
            field("#new-list-name", "Failed list\ue007")
            wait(lambda: "创建清单失败，输入已保留" in session.text())
            assert session.script("return document.querySelector('#new-list-name').value") == "Failed list"
            button("重命名清单")
            field("#rename-list", "Failed rename\ue007")
            wait(lambda: "重命名失败，输入已保留" in session.text())
            assert session.script("return document.querySelector('#rename-list').value") == "Failed rename"
            button("取消重命名")
            session.click('select[aria-label="移动任务：Work task"] option[value="inbox"]')
            wait(lambda: "移动失败，任务仍在原清单" in session.text() and not session.script("return document.querySelector('select[aria-label=\"移动任务：Work task\"]').disabled"))
            assert session.script("return document.querySelector('select[aria-label=\"移动任务：Work task\"]').value") == str(personal)
            button("删除清单")
            button("确认删除清单")
            wait(lambda: "清单删除失败，任务和清单仍保留" in session.text())
            assert session.script("return document.querySelector('h1').textContent") == "个人项目"
            assert snapshot() == before_lock
            record("07-real-write-lock-failures")
        finally:
            lock.rollback()
            lock.close()
        field("#new-list-name", "")
        button("取消删除清单")

        button("删除清单")
        assert "任务会回到收件箱，不会被删除" in session.text()
        button("取消删除清单")
        assert snapshot() == before_lock
        button("删除清单")
        button("确认删除清单")
        wait(lambda: session.script("return document.querySelector('h1').textContent === '收件箱'"))
        wait(lambda: "Work task" in session.text())
        deleted = snapshot()
        assert [row["id"] for row in deleted["lists"]] == [work]
        preserved(before_lock["tasks"], deleted["tasks"])
        assert deleted["tasks"][0]["list_id"] is None and deleted["tasks"][0]["updated_at"] > before_lock["tasks"][0]["updated_at"]
        assert deleted["tasks"][1] == before_lock["tasks"][1]
        record("08-delete-list-retains-tasks-and-resets-view")
        restart()
        assert snapshot() == deleted
        assert "Work task" in session.text() and "Personal task" in session.text() and "Inbox task" in session.text()
        assert not session.elements('[aria-label="打开清单：个人项目"]')
        record("09-delete-list-restart")

        open_list("工作")
        assert session.elements('[aria-label="取消完成：Completed task"]')
        before_delete_work = snapshot()
        button("删除清单")
        button("确认删除清单")
        wait(lambda: session.elements('[aria-label="取消完成：Completed task"]') and session.script("return document.querySelector('h1').textContent === '收件箱'"))
        final_tasks = snapshot()["tasks"]
        preserved(before_delete_work["tasks"], final_tasks)
        assert all(row["list_id"] is None for row in final_tasks)
        assert final_tasks[1]["updated_at"] > before_delete_work["tasks"][1]["updated_at"]
        restart()
        assert snapshot()["tasks"] == final_tasks and snapshot()["lists"] == []
        assert session.elements('[aria-label="取消完成：Completed task"]')
        assert "4 项任务" in session.text()
        record("10-completed-task-return-and-restart")

        for task in final_tasks:
            session.click(f"[aria-label={json.dumps('删除：' + task['title'], ensure_ascii=False)}]")
            button("永久删除")
            wait(lambda: not any(row["id"] == task["id"] for row in snapshot()["tasks"]))
            wait(lambda: not session.elements(f"[aria-label={json.dumps('删除：' + task['title'], ensure_ascii=False)}]"))
        record("11-ui-cleanup-empty")
        assert snapshot()["lists"] == [] and snapshot()["tasks"] == []
        report["gate"] = "PASS"
    except Exception as error:
        report["gate"] = "FAIL"
        report["error"] = str(error)
        if session:
            report["failed_ui"] = session.text()
            session.screenshot("failure")
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
