"""Inspect the built Quick Add entry and every imported JS chunk for SQL/boot."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / 'dist/quick-add.html').read_text(encoding='utf-8')
entry = re.search(r'<script[^>]+src="([^"]+)"', html)[1]
seen = set()


def inspect(path):
    path = path.resolve()
    assert path.is_relative_to((ROOT / 'dist').resolve())
    if path in seen:
        return
    seen.add(path)
    content = path.read_text(encoding='utf-8')
    for forbidden in ('plugin:sql|', 'database_boot_status', 'show_quick_add'):
        assert forbidden not in content, (path, forbidden)
    for imported in re.findall(r'''["'](\./[^"']+\.js)["']''', content):
        inspect(path.parent / imported)


inspect(ROOT / 'dist' / entry.lstrip('/'))
source = (ROOT / 'src/windows/quick-add.tsx').read_text(encoding='utf-8')
assert 'MainQueryProvider' not in source and 'DatabaseGate' not in source
print('PASS isolated Quick Add bundle: ' + ', '.join(path.name for path in sorted(seen)))
