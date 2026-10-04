"""Audit every automatically loaded capability against the stage's exact allowlist."""
import argparse
import json
from pathlib import Path
import re
import tomllib

ROOT = Path(__file__).resolve().parents[1] / 'src-tauri'
parser = argparse.ArgumentParser()
parser.add_argument('--step', type=int, choices=(11, 12, 14, 15, 16, 17, 18, 19, 20), required=True)
args = parser.parse_args()
main = {'core:event:allow-listen', 'core:event:allow-unlisten', 'main-database-boot-status', 'sql:allow-select', 'sql:allow-execute'}
expected = {'main': main}
commands = {'database_boot_status'}
if args.step >= 12:
    main.add('main-show-quick-add')
    expected['quick-add'] = {'core:event:allow-listen', 'core:event:allow-unlisten', 'quick-create-task', 'quick-hide-window'}
    commands.update({'show_quick_add', 'create_quick_task', 'hide_quick_add'})
if args.step >= 14:
    main.add('main-global-shortcut-status')
    commands.add('global_shortcut_status')
if args.step >= 15:
    main.update({'main-lifecycle-status', 'main-write-lifecycle'})
    commands.update({'lifecycle_status', 'begin_main_write', 'finish_main_write'})
if args.step >= 16:
    main.add("main-reminders")
    commands.update({'reminder_scheduler_status', 'create_reminder', 'edit_reminder', 'delete_reminder', 'update_task_status', 'reconcile_reminders'})
if args.step >= 18:
    main.add('main-backup-restore')
    commands.update({'backup_database', 'restore_database', 'restore_status'})
if args.step >= 19:
    main.add('main-autostart')
    commands.update({'autostart_status', 'set_autostart'})
schema = json.loads((ROOT / 'gen/schemas/desktop-schema.json').read_text(encoding='utf-8'))
known = set(re.findall(r'"const": "([^"]+)"', json.dumps(schema)))
seen = set()
for path in (ROOT / 'capabilities').glob('*.json'):
    cap = json.loads(path.read_text(encoding='utf-8'))
    assert cap['windows'] in [[label] for label in expected], path
    label = cap['windows'][0]
    assert label not in seen and not cap.get('remote') and 'webviews' not in cap, path
    seen.add(label)
    assert set(cap['permissions']) == expected[label], (path, cap['permissions'])
    assert set(cap['permissions']) <= known, 'Schema contains every granted permission'
assert seen == set(expected)
config = json.loads((ROOT / 'tauri.conf.json').read_text(encoding='utf-8'))
assert not config['app']['security'].get('capabilities'), 'No explicit capability overlay'
build_commands = set(re.findall(r'"([a-z_]+)"', (ROOT / 'build.rs').read_text(encoding='utf-8')))
assert build_commands == commands, build_commands
handler = re.search(r'generate_handler!\[(.*?)\]', (ROOT / 'src/lib.rs').read_text(encoding='utf-8'), re.S)[1]
assert {part.strip().split('::')[-1] for part in handler.split(',') if part.strip()} == commands
allowed = set()
for path in (ROOT / 'permissions').glob('*.toml'):
    for permission in tomllib.loads(path.read_text(encoding='utf-8')).get('permission', []):
        allowed.update(permission.get('commands', {}).get('allow', []))
assert allowed == commands
print(f'PASS STEP {args.step}: exact windows, grants, schema identifiers, manifest, handlers and custom permissions')
