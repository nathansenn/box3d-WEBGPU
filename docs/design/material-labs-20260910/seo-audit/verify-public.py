#!/usr/bin/env python3
"""Bounded served SEO checks: HTML, discovery, redirects, errors and runtime assets."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import ssl
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
RELEASE = Path('/private/tmp/box3d-static-release-20260910')
ORIGIN = 'https://box3d.apxlabs.parts'
ALIAS = 'https://box3d-web-production.up.railway.app'
EXPECTED = hashlib.sha256((RELEASE / 'index.html').read_bytes()).hexdigest()
EXPECTED_RELEASE = json.loads((RELEASE / 'release-info.json').read_text())['release']
spec = importlib.util.spec_from_file_location('static_seo_audit', HERE / 'verify-static.py')
static = importlib.util.module_from_spec(spec)
spec.loader.exec_module(static)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url, method='GET'):
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    request = urllib.request.Request(url, method=method, headers={'User-Agent': 'BOX3D-release-verification/1.0'})
    try:
        response = opener.open(request, timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, dict(response.headers.items()), response.read(128 * 1024) if method == 'GET' else b''


cases = []


def case(path, kind, method='GET', origin=ORIGIN, **extra):
    cases.append({'url': origin + path, 'kind': kind, 'method': method, **extra})


case('/', 'html')
for study in static.STUDIES:
    case('/?studio=' + study, 'html')
for query in ['studio=liquid&material=honey&load=35&rate=0.2&camera=top', 'studio=bridge&camera=river-hero&quality=ultra&custom=1&target=5', 'studio=unknown', 'lab=canopy-load-capture', 'workbench=1', 'workspace=contest']:
    case('/?' + query, 'html')
for query in ['workspace=test', 'view=structural-test&studio=bridge', 'workspace=test&view=structural-test&studio=liquid']:
    case('/?' + query, 'internal')
case('/index.html', 'redirect', target=ORIGIN + '/')
case('/index.html?studio=glass&note=a%20b%2Fc', 'redirect', target=ORIGIN + '/?studio=glass&note=a%20b%2Fc')
for path in ['/', '/?studio=bridge&camera=river-hero', '/index.html?studio=glass', '/studio/references/material-labs/liquid.png?reference=1', '/missing-page?scene=glass']:
    case(path, 'redirect', 'HEAD', origin=ALIAS, target=ORIGIN + path)
for path in ['/', '/?studio=glass&camera=detail', '/missing-page?scene=glass']:
    case(path, 'https-redirect', 'HEAD', origin='http://box3d.apxlabs.parts', target=ORIGIN + path)
case('/health', 'health')
case('/release-info.json', 'release')
case('/licenses/project.txt', 'notice', 'HEAD')
case('/studio/materials/provenance.json', 'notice', 'HEAD')
manifest = json.loads((HERE.parent / 'release/railway-release-manifest.json').read_text())['files']
notices = [name for name in manifest if name.endswith('.LICENSE.txt')]
if notices:
    case('/' + notices[0], 'notice', 'HEAD')
for asset in ['assets/index-DaNDYoQL.js', 'assets/studio-worker-CiVNd5Bm.js']:
    case('/' + asset, 'script', expectedSha256=manifest[asset]['sha256'])
case('/assets/RoundedBoxGeometry-BAh20NZY.css', 'css', 'HEAD')
case('/studio/references/material-labs/liquid.png', 'share-image', 'HEAD')
case('/robots.txt', 'robots')
case('/sitemap.xml', 'sitemap')
for path in ['/missing-page', '/login', '/account', '/checkout', '/drafts', '/review', '/src/entry.ts', '/engine-probe.html', '/.git/config', '/studio/not-a-resource.png']:
    case(path, 'missing', 'HEAD')


def inspect(item):
    result = dict(item)
    try:
        status, raw_headers, body = fetch(item['url'], item['method'])
        headers = {key.lower(): value for key, value in raw_headers.items()}
        kind = item['kind']
        errors = []

        def check(condition, message):
            if not condition:
                errors.append(message)

        result.update({'status': status, 'headers': {key: headers.get(key) for key in ['content-type', 'location', 'x-robots-tag', 'cache-control', 'x-content-type-options']}, 'bytesRead': len(body)})
        if kind in ['html', 'internal']:
            check(status == 200 and 'text/html' in headers.get('content-type', ''), 'Expected successful HTML')
            content = body.decode('utf-8')
            parsed = static.audit(content, RELEASE, True)
            check(parsed['pass'], 'Served HTML contract failed')
            check(parsed['htmlSha256'] == EXPECTED, 'Served HTML is not the prepared artifact')
            if kind == 'internal':
                check(headers.get('x-robots-tag') == 'noindex, follow', 'Diagnostic state must be noindex, follow')
            else:
                check('noindex' not in headers.get('x-robots-tag', '') and 'nofollow' not in headers.get('x-robots-tag', ''), 'Ordinary application state must remain crawlable')
            result.update({'htmlSha256': parsed['htmlSha256'], 'canonical': ORIGIN + '/', 'htmlChecks': len(parsed['checks']), 'failedHtmlChecks': [c['name'] for c in parsed['checks'] if not c['pass']]})
        elif kind in ['redirect', 'https-redirect']:
            check(status == 308 if kind == 'redirect' else status in [301, 302, 307, 308], 'Expected canonical redirect')
            check(headers.get('location') == item['target'], 'Redirect must preserve path and query')
        elif kind in ['health', 'release']:
            check(status == 200 and 'application/json' in headers.get('content-type', ''), 'Expected release JSON')
            info = json.loads(body)
            check(info['entrySha256'] == EXPECTED and info['release'] == EXPECTED_RELEASE, 'Unexpected release identity')
            check(headers.get('x-robots-tag') == 'noindex', 'Operational endpoint must be noindex')
            if kind == 'health':
                check(headers.get('cache-control') == 'no-store', 'Health must not be cached')
            result['release'] = info['release']
        elif kind == 'notice':
            check(status == 200 and 'noindex' in headers.get('x-robots-tag', ''), 'Notice must remain available with noindex')
        elif kind in ['script', 'css']:
            expected_mime = 'javascript' if kind == 'script' else 'text/css'
            check(status == 200 and expected_mime in headers.get('content-type', ''), 'Wrong asset status or MIME')
            check(headers.get('x-content-type-options') == 'nosniff', 'Missing MIME protection')
            check(headers.get('cache-control') == 'public, max-age=31536000, immutable', 'Fingerprinted asset cache policy differs')
            if kind == 'script':
                result['sha256'] = hashlib.sha256(body).hexdigest()
                check(result['sha256'] == item['expectedSha256'], 'Runtime bytes changed')
        elif kind == 'share-image':
            check(status == 200 and 'image/png' in headers.get('content-type', ''), 'Share image unavailable')
            check('noindex' not in headers.get('x-robots-tag', ''), 'Share image unexpectedly excluded')
            check(int(headers.get('content-length', 0)) == (RELEASE / 'studio/references/material-labs/liquid.png').stat().st_size, 'Share image byte count differs')
        elif kind == 'robots':
            check(status == 200 and 'text/plain' in headers.get('content-type', ''), 'Robots must be a text resource')
            check(body == (RELEASE / 'robots.txt').read_bytes(), 'Robots differs from reviewed crawl policy')
        elif kind == 'sitemap':
            check(status == 200 and 'xml' in headers.get('content-type', ''), 'Sitemap must be successful XML')
            tree = ET.fromstring(body)
            urls = [n.text for n in tree.findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
            check(urls == [ORIGIN + '/'], 'Sitemap must contain only the canonical HTML page')
        elif kind == 'missing':
            check(status == 404, 'Missing/private/source paths must return a real 404')
        result.update({'pass': not errors, 'errors': errors})
    except Exception as error:
        result.update({'pass': False, 'error': str(error)})
    return result


with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(inspect, cases))
report = {'at': datetime.now(timezone.utc).isoformat(), 'origin': ORIGIN, 'expectedEntrySha256': EXPECTED, 'pass': all(r['pass'] for r in results), 'requests': len(results), 'results': results, 'scope': 'Served HTML and HTTP contract only. No simulation suite or media capture.'}
output = HERE / 'served-check.json'
output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'pass': report['pass'], 'requests': len(results), 'failed': [r for r in results if not r['pass']], 'output': str(output)}, indent=2))
raise SystemExit(0 if report['pass'] else 1)
