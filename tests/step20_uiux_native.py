"""Focused native UI check for the STEP 20 rail, compact sidebar and inspector."""
import sys
sys.dont_write_bytecode = True

import json
import os
from datetime import datetime
from pathlib import Path

import psutil
import native_support
from native_support import Harness, wait

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / "src-tauri/target/debug/todoa.exe"
DRIVER = Path(os.environ["TEMP"]) / "todoa-step8-webdriver-20261004/msedgedriver.exe"
IDENTIFIER = "com.todoa.desktop.test.step20"


def main():
    binary = BINARY.resolve()

    def isolated_pids():
        result = set()
        for process in psutil.process_iter(["pid", "exe"]):
            try:
                if process.info["exe"] and Path(process.info["exe"]).resolve() == binary:
                    result.add(process.info["pid"])
            except (OSError, psutil.Error):
                pass
        return result

    native_support.app_pids = isolated_pids
    assert DRIVER.is_file() and BINARY.is_file() and not isolated_pids()
    evidence = ROOT / "docs/evidence" / ("step20-uiux-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    evidence.mkdir(parents=True)
    harness = Harness(BINARY, IDENTIFIER, DRIVER, evidence)
    report = {"identifier": IDENTIFIER, "checks": [], "formal_app_untouched": True}
    title = None

    def check(name, condition, screenshot=True):
        wait(condition)
        item = {"name": name, "status": "PASS"}
        if screenshot:
            item["screenshot"] = harness.session.screenshot(name)
        report["checks"].append(item)
        print("PASS " + name, flush=True)

    try:
        harness.start()
        session = harness.session
        session.call("POST", "/window/rect", {"width": 1220, "height": 800})
        check("wide-rail-sidebar", lambda: session.script('return document.querySelector("nav[aria-label=一级导航]")?.querySelectorAll("button").length === 2 && document.querySelector("nav[aria-label=任务视图]")?.querySelectorAll("button").length === 5'))
        session.click('nav[aria-label="一级导航"] button:last-child')
        check("settings-groups", lambda: session.script('return document.querySelector("nav[aria-label=设置分组]")?.querySelectorAll("button").length === 3'))
        session.click('nav[aria-label="设置分组"] button:last-child')
        check("about-version", lambda: session.script('return document.querySelector("h1")?.textContent === "关于" && document.body.textContent.includes("Todoa 版本：0.1.0")'))
        session.click('nav[aria-label="一级导航"] button:first-child')
        session.call("POST", "/window/rect", {"width": 700, "height": 620})
        check("compact-vertical-rail", lambda: session.script('const b=[...document.querySelectorAll("nav[aria-label=一级导航] button")];return b.length===2 && b[1].getBoundingClientRect().top>b[0].getBoundingClientRect().bottom && b[0].getBoundingClientRect().left<100'))
        harness.button("打开任务视图")
        check("compact-sidebar-overlay", lambda: session.script('return !!document.querySelector("button[aria-label=关闭视图导航]")'))
        check("compact-sidebar-initial-focus", lambda: session.script('return document.activeElement?.getAttribute("aria-label")==="关闭视图导航"'), False)
        close_button = session.element('button[aria-label="关闭视图导航"]')
        session.call("POST", f"/element/{close_button}/value", {"text": "\ue00c"})
        check("compact-sidebar-escape-focus-return", lambda: session.script('return !document.querySelector("button[aria-label=关闭视图导航背景]") && document.activeElement?.textContent.trim()==="打开任务视图"'), False)
        harness.button("打开任务视图")
        check("compact-sidebar-reopens", lambda: session.script('return !!document.querySelector("button[aria-label=关闭视图导航背景]")'), False)
        session.click('nav[aria-label="任务视图"] button[aria-label="打开今天"]')
        check("compact-navigation-close", lambda: session.script('return !document.querySelector("button[aria-label=关闭视图导航背景]") && document.getElementById("inbox-heading")?.textContent === "今天"'))
        session.call("POST", "/window/rect", {"width": 1220, "height": 800})
        session.click('nav[aria-label="一级导航"] button:first-child')
        for old in session.script('return [...document.querySelectorAll(`li[data-task-id] button[aria-label^="删除：S20 UIUX "]`)].map(b=>b.getAttribute("aria-label"))'):
            session.click(f'button[aria-label="{old}"]')
            harness.button("永久删除")
            wait(lambda: not session.elements(f'button[aria-label="{old}"]'))
        title = "S20 UIUX " + datetime.now().strftime("%H%M%S")
        field = session.element("#task-title")
        session.call("POST", f"/element/{field}/value", {"text": title + "\ue007"})
        check("task-created-in-isolated-database", lambda: session.script('return !!document.querySelector(`button[aria-label="编辑任务：${arguments[0]}"]`)', title), False)
        session.click(f'button[aria-label="编辑任务：{title}"]')
        check("wide-nonmodal-inspector", lambda: session.script('return !!document.querySelector("aside[aria-label=任务详情]") && !document.querySelector("[role=dialog]")'))
        check("inspector-status-and-delete-actions", lambda: session.script('return !!document.querySelector("aside[aria-label=任务详情] [role=checkbox][aria-label=完成任务]") && !!document.querySelector("aside[aria-label=任务详情] button") && [...document.querySelectorAll("aside[aria-label=任务详情] button")].some(b=>b.textContent.trim()==="永久删除任务")'))
        session.click('aside[aria-label="任务详情"] [role="checkbox"]')
        check("inspector-completes-task", lambda: session.script('return document.querySelector(`button[aria-label="编辑任务：${arguments[0]}"]`)?.closest("li")?.querySelector("[role=checkbox]")?.getAttribute("aria-checked")==="true"', title), False)
        session.click('aside[aria-label="任务详情"] [role="checkbox"]')
        check("inspector-restores-task-status", lambda: session.script('return document.querySelector(`button[aria-label="编辑任务：${arguments[0]}"]`)?.closest("li")?.querySelector("[role=checkbox]")?.getAttribute("aria-checked")==="false"', title), False)
        harness.button("永久删除任务")
        check("inspector-delete-confirmation", lambda: session.script('return !!document.querySelector("[role=dialog]") && document.body.textContent.includes("任务及关联的标签关系、提醒将被删除")'), False)
        harness.button("取消")
        wait(lambda: not session.elements('[role="dialog"]'))
        session.click('button[aria-label="关闭任务详情"]')
        check("inspector-closes-and-returns-focus", lambda: session.script('return !document.querySelector("aside[aria-label=任务详情]") && document.activeElement?.getAttribute("aria-label")===arguments[0]', f"编辑任务：{title}"), False)
        session.call("POST", "/window/rect", {"width": 900, "height": 700})
        wait(lambda: session.script('return innerWidth >= 760 && innerWidth < 1100'))
        session.click(f'button[aria-label="编辑任务：{title}"]')
        check("medium-right-detail-overlay", lambda: session.script('const p=document.querySelector("[data-slot=dialog-content]");return !!p && p.getBoundingClientRect().right >= innerWidth-20 && p.getBoundingClientRect().height >= innerHeight-4'))
        session.click('button[aria-label="关闭任务详情"]')
        wait(lambda: not session.elements('[data-slot="dialog-content"]'))
        session.call("POST", "/window/rect", {"width": 700, "height": 620})
        wait(lambda: session.script('return innerWidth < 760'))
        session.click(f'button[aria-label="编辑任务：{title}"]')
        check("compact-full-height-detail", lambda: session.script('const p=document.querySelector("[data-slot=dialog-content]");return !!p && p.getBoundingClientRect().height >= innerHeight-4'))
        session.click('button[aria-label="关闭任务详情"]')
        wait(lambda: not session.elements('[data-slot="dialog-content"]'))
        session.click(f'button[aria-label="删除：{title}"]')
        harness.button("永久删除")
        check("isolated-task-cleaned", lambda: session.script('return !document.querySelector(`button[aria-label="编辑任务：${arguments[0]}"]`)', title), False)
    except Exception as error:
        report["status"] = "FAIL"
        report["error"] = str(error)
        raise
    else:
        report["status"] = "PASS"
    finally:
        if title and harness.session:
            try:
                if harness.session.elements('button[aria-label="关闭任务详情"]'):
                    harness.session.click('button[aria-label="关闭任务详情"]')
                if harness.session.elements(f'button[aria-label="删除：{title}"]'):
                    harness.session.click(f'button[aria-label="删除：{title}"]')
                    harness.button("永久删除")
                    wait(lambda: not harness.session.elements(f'button[aria-label="删除：{title}"]'))
            except Exception as cleanup_error:
                report["cleanup_error"] = str(cleanup_error)
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            if harness.session and harness.session.pid in isolated_pids():
                try:
                    harness.click_menu("退出")
                    wait(lambda: harness.session.pid not in isolated_pids())
                except Exception:
                    psutil.Process(harness.session.pid).terminate()
                    wait(lambda: harness.session.pid not in isolated_pids())
        finally:
            harness.stop_driver()
            harness.log.close()
        print(evidence / "report.json", flush=True)


if __name__ == "__main__":
    main()
