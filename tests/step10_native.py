"""STEP 10 isolated real Tauri UI: tags, SQL constraints, cascades, restarts.

Build with tauri.step10-test.conf.json. No business rows are written by Python.
Snapshots are read-only; the one writable Python connection only holds a lock.
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
IDENTIFIER = "com.todoa.desktop.test.step10"
DB = Path(os.environ["APPDATA"]) / IDENTIFIER / "todo.db"


def snapshot():
    with sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        return {
            "schema": db.execute("PRAGMA user_version").fetchone()[0],
            "application_id": db.execute("PRAGMA application_id").fetchone()[0],
            "migration_count": db.execute("SELECT count(*) FROM _sqlx_migrations WHERE version=1 AND success=1").fetchone()[0],
            "foreign_key_check": [list(row) for row in db.execute("PRAGMA foreign_key_check")],
            "lists": [dict(row) for row in db.execute("SELECT * FROM lists ORDER BY id")],
            "tasks": [dict(row) for row in db.execute("SELECT * FROM tasks ORDER BY id")],
            "tags": [dict(row) for row in db.execute("SELECT * FROM tags ORDER BY id")],
            "task_tags": [dict(row) for row in db.execute("SELECT * FROM task_tags ORDER BY task_id,tag_id")],
        }


def css_label(label):
    return f"[aria-label={json.dumps(label, ensure_ascii=False)}]"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--native-driver", type=Path, required=True)
    parser.add_argument("--step", type=int, choices=(10, 11), default=10)
    args = parser.parse_args()
    global IDENTIFIER, DB
    IDENTIFIER = f"com.todoa.desktop.test.step{args.step}"
    DB = Path(os.environ["APPDATA"]) / IDENTIFIER / "todo.db"
    stamp = datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%d-%H%M%S")
    evidence = ROOT / "docs/evidence" / f"step{args.step}-tags-{stamp}"
    evidence.mkdir(parents=True, exist_ok=False)
    report = {"database": str(DB), "initial_database_exists": DB.exists(), "checks": [], "sessions": []}
    session = None
    log = (evidence / "driver.txt").open("w", encoding="utf-8")
    port = 4470
    driver = subprocess.Popen([str(Path.home() / ".cargo/bin/tauri-driver.exe"), "--port", str(port), "--native-port", str(port + 1), "--native-driver", str(args.native_driver)], stdout=log, stderr=log, creationflags=HIDDEN)

    def start():
        native = NativeSession(ROOT / "src-tauri/target/x86_64-pc-windows-msvc/debug/todoa.exe", port, evidence, IDENTIFIER)
        wait(lambda: native.script("return !!document.querySelector('#new-tag-name') && !document.querySelector('#new-tag-name').disabled"))
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
        # Actual keyboard events clear React's controlled state as well as the DOM.
        element = session.element(selector)
        session.call("POST", f"/element/{element}/value", {"text": "\ue009a\ue000\ue003" + value})

    def button(label):
        element = wait(lambda: session.script("return Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === arguments[0])", label))
        session.call("POST", f"/element/{element[ELEMENT]}/click", {})

    def open_inbox():
        session.click(css_label("打开收件箱"))
        wait(lambda: session.script("return document.querySelector('h1')?.textContent === '收件箱'"))
        session.ready()

    def visible_ids():
        return session.script("return Array.from(document.querySelectorAll('[data-task-id]')).map(row => Number(row.dataset.taskId)).sort((a,b)=>a-b)")

    def open_tag(name, ids):
        session.click(css_label("打开标签：" + name))
        wait(lambda: session.script("return document.querySelector('h1')?.textContent === arguments[0]", "标签：" + name))
        wait(lambda: visible_ids() == sorted(ids))
        assert not session.elements("#task-title")

    def create_tag(name):
        field("#new-tag-name", name + "\ue007")
        wait(lambda: session.elements(css_label("打开标签：" + name)))
        wait(lambda: session.script("return document.querySelector('#new-tag-name').value === '' && !document.querySelector('#new-tag-name').disabled"))
        return next(row["id"] for row in snapshot()["tags"] if row["name"] == name)

    def conflict(name):
        before = snapshot()
        field("#new-tag-name", name + "\ue007")
        wait(lambda: "标签名称已存在，请使用其他名称。" in session.text() and not session.script("return document.querySelector('#new-tag-name').disabled"))
        assert session.script("return document.querySelector('#new-tag-name').value") == name
        assert snapshot() == before

    def create_task(title):
        session.keys(title + "\ue007")
        wait(lambda: session.elements(css_label("分配标签：" + title)))
        wait(lambda: session.script("return document.querySelector('#task-title').value === ''"))
        return next(row["id"] for row in snapshot()["tasks"] if row["title"] == title)

    def choose(title, tag_id):
        session.click("select" + css_label("分配标签：" + title) + f" option[value='{tag_id}']")

    def assign(title, tag_id, tag_name):
        choose(title, tag_id)
        session.click(css_label("分配所选标签：" + title))
        wait(lambda: session.script("return document.querySelector(arguments[0]).value === ''", "select" + css_label("分配标签：" + title)))
        wait(lambda: session.elements(css_label(f"移除标签：{title}：{tag_name}")))
        task_id = next(row["id"] for row in snapshot()["tasks"] if row["title"] == title)
        assert sum(row["task_id"] == task_id and row["tag_id"] == tag_id for row in snapshot()["task_tags"]) == 1

    def delete_tag(name):
        session.click(css_label("删除标签：" + name))
        session.click(css_label("确认删除标签：" + name))
        wait(lambda: not session.elements(css_label("打开标签：" + name)))
        wait(lambda: not session.script("return !!document.querySelector('[aria-label=\"确认删除标签\"]')"))

    def delete_task(title):
        session.click(css_label("删除：" + title))
        button("永久删除")
        wait(lambda: not session.elements(css_label("删除：" + title)))
        wait(lambda: not any(row["title"] == title for row in snapshot()["tasks"]))

    def record(name):
        state = snapshot()
        assert state["schema"] == 1 and state["application_id"] == 0x57544431 and state["migration_count"] == 1 and state["foreign_key_check"] == []
        assert session.script("return document.querySelectorAll('h1').length") == 1
        report["checks"].append({"name": name, "status": "PASS", "sqlite": state, "ui": session.text(), "visible_task_ids": visible_ids(), "screenshot": session.screenshot(name)})
        print(f"PASS {name}", flush=True)

    try:
        def driver_ready():
            try:
                with urlopen(f"http://127.0.0.1:{port}/status", timeout=2) as response:
                    return json.load(response)["value"]["ready"]
            except OSError:
                return False
        wait(driver_ready)
        if DB.exists():
            state = snapshot()
            assert all(state[key] == [] for key in ("lists", "tasks", "tags", "task_tags")), "Requires an empty isolated STEP 10 DB"
        session = start()
        field("#new-tag-name", "   \ue007")
        wait(lambda: "标签名称长度" in session.text())
        assert snapshot()["tags"] == []
        for code in (0, 0xD800):
            session.script("const input = document.querySelector('#new-tag-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'bad' + String.fromCharCode(arguments[0]) + 'tag'); input.dispatchEvent(new Event('input', {bubbles:true}));", code)
            button("创建标签")
            wait(lambda: "标签名称包含无效字符" in session.text())
            assert snapshot()["tags"] == []
        field("#new-tag-name", "")
        record("01-empty-and-invalid-name")

        work = create_tag("Work")
        conflict("work")
        conflict("WORK")
        family = create_tag("家庭")
        conflict("家庭")
        chore = create_tag("家务")
        assert [row["name"] for row in snapshot()["tags"]] == ["Work", "家庭", "家务"]
        record("02-ascii-case-conflicts-and-chinese")

        inbox_task = create_task("Inbox tagged")
        unrelated = create_task("Unrelated")
        task_before = snapshot()["tasks"]
        assign("Inbox tagged", work, "Work")
        duplicate_before = snapshot()
        assign("Inbox tagged", work, "Work")
        assert snapshot() == duplicate_before
        assign("Inbox tagged", family, "家庭")
        assign("Unrelated", family, "家庭")
        assert snapshot()["tasks"] == task_before
        field("#new-list-name", "工作\ue007")
        wait(lambda: session.script("return document.querySelector('h1')?.textContent === '工作'"))
        session.ready()
        list_task = create_task("List tagged")
        session.click(css_label("完成：List tagged"))
        wait(lambda: session.elements(css_label("取消完成：List tagged")))
        task_before = snapshot()["tasks"]
        assign("List tagged", work, "Work")
        assign("List tagged", chore, "家务")
        assert snapshot()["tasks"] == task_before and len(snapshot()["task_tags"]) == 5
        record("03-assignment-and-idempotence")
        before_restart = snapshot()
        restart()
        assert snapshot() == before_restart
        open_tag("Work", [inbox_task, list_task])
        assert session.elements(css_label("取消完成：List tagged"))
        open_tag("家庭", [inbox_task, unrelated])
        open_tag("家务", [list_task])
        open_tag("Work", [inbox_task, list_task])
        record("04-assignment-restart-and-sql-filter")

        open_inbox()
        wait(lambda: session.elements(css_label("分配标签：Inbox tagged")))
        before_invalid = snapshot()
        session.script("const field = document.querySelector(arguments[0]); field.add(new Option('Missing test tag', '999999999')); field.value = '999999999'; field.dispatchEvent(new Event('change', {bubbles:true}));", "select" + css_label("分配标签：Inbox tagged"))
        session.click(css_label("分配所选标签：Inbox tagged"))
        wait(lambda: "分配标签失败，请重试。" in session.text())
        assert snapshot() == before_invalid
        record("05-missing-tag-foreign-key-rejection")
        open_tag("Work", [inbox_task, list_task])
        open_inbox()
        wait(lambda: session.elements(css_label("分配标签：Inbox tagged")))

        before_lock = snapshot()
        lock = sqlite3.connect(DB)
        try:
            lock.execute("BEGIN IMMEDIATE")
            field("#new-tag-name", "Failed tag\ue007")
            wait(lambda: "创建标签失败，输入已保留。" in session.text())
            assert session.script("return document.querySelector('#new-tag-name').value") == "Failed tag"
            choose("Inbox tagged", chore)
            session.click(css_label("分配所选标签：Inbox tagged"))
            wait(lambda: "分配标签失败，请重试。" in session.text())
            assert not session.elements(css_label("移除标签：Inbox tagged：家务"))
            session.click(css_label("移除标签：Inbox tagged：家庭"))
            wait(lambda: "移除标签失败，请重试。" in session.text())
            assert session.elements(css_label("移除标签：Inbox tagged：家庭"))
            session.click(css_label("删除标签：Work"))
            session.click(css_label("确认删除标签：Work"))
            wait(lambda: "删除标签失败，标签和关联仍保留。" in session.text())
            assert snapshot() == before_lock
            record("06-real-write-lock-failures")
        finally:
            lock.rollback()
            lock.close()
        button("取消删除标签")
        field("#new-tag-name", "")

        open_tag("Work", [inbox_task, list_task])
        tasks_before_remove = snapshot()["tasks"]
        session.click(css_label("移除标签：Inbox tagged：Work"))
        wait(lambda: visible_ids() == [list_task])
        assert snapshot()["tasks"] == tasks_before_remove and len(snapshot()["task_tags"]) == 4
        record("07-remove-relation-keeps-task")
        before_restart = snapshot()
        restart()
        assert snapshot() == before_restart
        open_tag("Work", [list_task])
        open_tag("家庭", [inbox_task, unrelated])
        record("08-removal-restart")

        open_tag("Work", [list_task])
        before_task_delete = snapshot()
        delete_task("List tagged")
        wait(lambda: visible_ids() == [])
        after_task_delete = snapshot()
        assert after_task_delete["tasks"] == [row for row in before_task_delete["tasks"] if row["id"] != list_task]
        assert after_task_delete["tags"] == before_task_delete["tags"]
        assert after_task_delete["task_tags"] == [row for row in before_task_delete["task_tags"] if row["task_id"] != list_task]
        record("09-task-delete-cascades-relations")
        restart()
        assert snapshot() == after_task_delete
        open_tag("Work", [])
        open_tag("家务", [])
        open_tag("家庭", [inbox_task, unrelated])
        record("10-task-delete-restart")

        before_tag_delete = snapshot()
        session.click(css_label("删除标签：家庭"))
        assert "关联会被移除，任务不会被删除" in session.text()
        button("取消删除标签")
        assert snapshot() == before_tag_delete
        delete_tag("家庭")
        wait(lambda: session.script("return document.querySelector('h1').textContent === '收件箱'"))
        wait(lambda: visible_ids() == sorted([inbox_task, unrelated]))
        after_tag_delete = snapshot()
        assert after_tag_delete["tasks"] == before_tag_delete["tasks"]
        assert after_tag_delete["task_tags"] == []
        assert after_tag_delete["tags"] == [row for row in before_tag_delete["tags"] if row["id"] != family]
        record("11-tag-delete-cascades-only-relations")
        restart()
        assert snapshot() == after_tag_delete
        assert not session.elements(css_label("打开标签：家庭"))
        wait(lambda: visible_ids() == sorted([inbox_task, unrelated]))
        record("12-tag-delete-restart")

        delete_tag("Work")
        delete_tag("家务")
        session.click(css_label("打开清单：工作"))
        wait(lambda: session.script("return document.querySelector('h1').textContent === '工作'"))
        button("删除清单")
        button("确认删除清单")
        wait(lambda: session.script("return document.querySelector('h1').textContent === '收件箱'"))
        wait(lambda: visible_ids() == sorted([inbox_task, unrelated]))
        delete_task("Inbox tagged")
        delete_task("Unrelated")
        assert all(snapshot()[key] == [] for key in ("lists", "tasks", "tags", "task_tags"))
        record("13-ui-cleanup-empty")
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
