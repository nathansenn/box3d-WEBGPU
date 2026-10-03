#!/usr/bin/env python3
"""Derive an SEO-only release while proving the published runtime is unchanged."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[4]
RELEASE = Path('/private/tmp/box3d-static-release-20260910')
AUDIT = Path(__file__).resolve().parent
BASE = '1917fb9f5efcdf543c6a3c9520c0b623d7c7f0d0'


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=RELEASE, text=True).strip()


assert git('rev-parse', 'HEAD') == BASE, 'Unexpected frozen-release revision'
assert git('status', '--porcelain') == '', 'Frozen release is not clean'
baseline = json.loads((ROOT / 'docs/design/material-labs-20260910/release/railway-release-manifest.json').read_text())
for name, row in baseline['files'].items():
    assert sha(RELEASE / name) == row['sha256'], 'Frozen file changed: ' + name

source_report = json.loads((AUDIT / 'source-check.json').read_text())
assert source_report['pass'] and source_report['htmlSha256'] == sha(ROOT / 'index.html'), 'Source HTML needs current validation'
old_html = (RELEASE / 'index.html').read_text()
module_tags = re.findall(r'<script\b[^>]*type="module"[^>]*>\s*</script>', old_html)
assert len(module_tags) == 1 and './assets/index-DaNDYoQL.js' in module_tags[0], 'Unexpected compiled entry'
source_html = (ROOT / 'index.html').read_text()
source_tag = '<script type="module" src="/src/entry.ts"></script>'
assert source_html.count(source_tag) == 1
derived_html = source_html.replace(source_tag, module_tags[0])

(RELEASE / 'index.html').write_text(derived_html)
for source, target in [('public/robots.txt', 'robots.txt'), ('public/sitemap.xml', 'sitemap.xml'), ('deploy/railway/Caddyfile', 'Caddyfile'), ('deploy/railway/Dockerfile', 'Dockerfile')]:
    (RELEASE / target).write_bytes((ROOT / source).read_bytes())
dockerignore = (RELEASE / '.dockerignore').read_text().replace('!release-info.json\n', '!release-info.json\n!robots.txt\n!sitemap.xml\n')
(RELEASE / '.dockerignore').write_text(dockerignore)

info_path = RELEASE / 'release-info.json'
info = json.loads(info_path.read_text())
info['baseApplicationRelease'] = info['release']
info['release'] = 'material-studies-20260910-seo-v1'
info['entrySha256'] = sha(RELEASE / 'index.html')
info['applicationArtifactCommit'] = baseline['frozenBaseCommit']
info['seo'] = {'revision': '20260910-v1', 'canonicalUrl': 'https://box3d.apxlabs.parts/', 'logicalPublicHtmlPages': 1, 'studySelectorCount': 8}
info_path.write_text(json.dumps(info, indent=2) + '\n')

expected = {'.dockerignore', 'Caddyfile', 'Dockerfile', 'index.html', 'release-info.json', 'robots.txt', 'sitemap.xml'}
changed = {line[3:] for line in subprocess.check_output(['git', 'status', '--porcelain'], cwd=RELEASE, text=True).splitlines()}
assert changed == expected, 'Unexpected change scope: ' + repr(changed)
unchanged = {}
for name, row in baseline['files'].items():
    if name not in expected:
        unchanged[name] = sha(RELEASE / name) == row['sha256']
assert all(unchanged.values()), 'Runtime or media bytes changed'

report = {
    'at': datetime.now(timezone.utc).isoformat(),
    'pass': True,
    'baseReleaseCommit': BASE,
    'baseApplicationCommit': baseline['frozenBaseCommit'],
    'sourceHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'sourceIndexSha256': source_report['htmlSha256'],
    'entrySha256': sha(RELEASE / 'index.html'),
    'entryScript': module_tags[0],
    'changedFiles': {name: {'bytes': (RELEASE / name).stat().st_size, 'sha256': sha(RELEASE / name)} for name in sorted(expected)},
    'unchangedFrozenFiles': unchanged,
    'newApplicationBuild': False,
    'newMedia': False,
    'deployedVerified': False,
    'marketingReady': False,
    'caddyValidation': 'Pending existing Dockerfile validation; local Caddy is unavailable and Railway SSH has no registered key. No credentials were added.'
}
(AUDIT / 'prepared-release.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'pass': True, 'changedFiles': sorted(changed), 'unchangedFrozenFiles': len(unchanged), 'entrySha256': report['entrySha256'], 'newLocalPayloadBytes': sum(row['bytes'] for row in report['changedFiles'].values())}, indent=2))
