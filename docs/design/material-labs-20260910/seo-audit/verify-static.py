#!/usr/bin/env python3
"""Check the public HTML contract without building or running the simulation."""
import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import struct
import subprocess
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[4]
CANONICAL = 'https://box3d.apxlabs.parts/'
STUDIES = ['liquid', 'glass', 'concrete', 'rubber', 'granular', 'plate', 'canopy', 'bridge']


class Document(HTMLParser):
    def __init__(self, content):
        super().__init__(convert_charrefs=True)
        self.nodes = []
        self.stack = []
        self.visible = []
        self.feed(content)

    def handle_starttag(self, tag, attrs):
        node = {'tag': tag, 'attrs': dict(attrs), 'text': ''}
        self.nodes.append(node)
        if tag not in ('meta', 'link', 'img', 'input', 'br', 'hr', 'source', 'wbr'):
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]['tag'] == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, text):
        for node in self.stack:
            node['text'] += text
        tags = {node['tag'] for node in self.stack}
        if 'body' in tags and not tags.intersection({'script', 'style'}):
            self.visible.append(text)

    def find(self, tag, **attrs):
        return [n for n in self.nodes if n['tag'] == tag and all(n['attrs'].get(k) == v for k, v in attrs.items())]


def audit(html, resources, compiled=False):
    document = Document(html)
    checks = []

    def check(name, condition, detail):
        checks.append({'name': name, 'pass': bool(condition), 'detail': detail})

    def one(tag, **attrs):
        values = document.find(tag, **attrs)
        return values[0] if len(values) == 1 else {'attrs': {}, 'text': ''}

    def meta(key, prop=False):
        return one('meta', **{('property' if prop else 'name'): key})['attrs'].get('content', '')

    title = one('title')['text'].strip()
    description = meta('description')
    canonical = one('link', rel='canonical')['attrs'].get('href')
    check('identity', 'BOX3D Engineering Studio' in title and bool(description), {'title': title, 'description': description})
    check('one_absolute_canonical', canonical == CANONICAL, canonical)
    check('document_basics', one('html')['attrs'].get('lang') == 'en' and bool(one('meta', charset='UTF-8')['attrs']) and 'width=device-width' in meta('viewport'), 'English, UTF-8, responsive viewport')
    robots = meta('robots').lower()
    check('crawlable_page', bool(robots) and 'noindex' not in robots and 'nofollow' not in robots, robots)

    share = {key: meta('og:' + key, True) for key in ['type', 'site_name', 'title', 'description', 'url', 'image', 'image:type', 'image:width', 'image:height', 'image:alt']}
    check('open_graph', all(share.values()) and share['type'] == 'website' and share['title'] == title and share['url'] == canonical, share)
    twitter = {key: meta('twitter:' + key) for key in ['card', 'title', 'description', 'image', 'image:alt']}
    check('twitter', all(twitter.values()) and twitter['card'] == 'summary_large_image' and twitter['title'] == title and twitter['image'] == share['image'], twitter)
    image_path = resources / urlsplit(share['image']).path.lstrip('/')
    with image_path.open('rb') as stream:
        png_header = stream.read(24)
    width, height = struct.unpack('>II', png_header[16:24])
    check('existing_share_image', png_header[:8] == b'\x89PNG\r\n\x1a\n' and [str(width), str(height)] == [share['image:width'], share['image:height']] and 'design reference' in share['image:alt'].lower(), {'path': str(image_path), 'dimensions': [width, height]})
    check('explicit_existing_browser_icon', one('link', rel='icon')['attrs'].get('href') == urlsplit(share['image']).path, 'The browser icon reuses the approved studio image')

    schema_nodes = document.find('script', type='application/ld+json')
    schema = json.loads(schema_nodes[0]['text']) if len(schema_nodes) == 1 else {}
    graph = schema.get('@graph', [])
    types = [node.get('@type') for node in graph]
    check('structured_data', schema.get('@context') == 'https://schema.org' and types == ['WebSite', 'WebApplication'] and all(node.get('url') == CANONICAL for node in graph), types)
    schema_text = json.dumps(schema)
    application = next((node for node in graph if node.get('@type') == 'WebApplication'), {})
    check('truthful_schema', 'not calibrated engineering results' in application.get('description', '') and not any(key in schema_text for key in ['aggregateRating', 'reviewRating', 'offers', 'price', 'award']), 'Authored comparative application; no invented commercial or rating claims')
    check('schema_image_parity', application.get('image', {}).get('url') == share['image'] and application.get('image', {}).get('width') == width and application.get('image', {}).get('height') == height, 'HTML and ImageObject reuse the same approved image')

    visible = ' '.join(' '.join(document.visible).split())
    h1 = document.find('h1')
    check('meaningful_initial_html', len(h1) == 1 and h1[0]['text'].strip() == 'BOX3D Engineering Studio' and len(visible.split()) >= 150, {'h1': [n['text'] for n in h1], 'visibleWords': len(visible.split()), 'visibleCharacters': len(visible)})
    anchors = document.find('a')
    study_links = {n['attrs'].get('href'): n['text'].strip() for n in anchors if n['attrs'].get('href', '').startswith('/?studio=')}
    check('eight_descriptive_study_links', set(study_links) == {'/?studio=' + study for study in STUDIES} and all(len(text.split()) >= 2 for text in study_links.values()), study_links)
    check('project_and_license_links', all(any(n['attrs'].get('href') == url for n in anchors) for url in ['https://github.com/nathansenn/box3d-WEBGPU', '/licenses/project.txt']) and (resources / 'licenses/project.txt').is_file(), 'Public repository and shipped code license; no issue tracker or contact promise')
    check('model_limits_visible', 'uncalibrated' in visible and 'authored coefficients' in visible and '40 material profiles and 40 prepared experiments' in visible, 'Model limitations and feature counts appear in initial content')
    images = document.find('img')
    check('image_accessibility', bool(images) and all(n['attrs'].get('alt') and n['attrs'].get('width') and n['attrs'].get('height') for n in images), [n['attrs'] for n in images])
    module = one('script', type='module')['attrs'].get('src')
    module_valid = bool(module) and ((resources / module.removeprefix('./')).is_file() if compiled else module == '/src/entry.ts')
    check('entry_module', module_valid, module)
    return {'at': datetime.now(timezone.utc).isoformat(), 'pass': all(c['pass'] for c in checks), 'htmlSha256': hashlib.sha256(html.encode()).hexdigest(), 'checks': checks}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', type=Path, default=Path('/private/tmp/box3d-static-release-20260910'))
    parser.add_argument('--compiled', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    html_path = args.release / 'index.html' if args.compiled else ROOT / 'index.html'
    report = audit(html_path.read_text(), args.release, args.compiled)
    public = args.release if args.compiled else ROOT / 'public'
    sitemap = ET.parse(public / 'sitemap.xml')
    locations = [n.text for n in sitemap.findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
    robots = (public / 'robots.txt').read_text()
    report['checks'].extend([
        {'name': 'canonical_sitemap', 'pass': locations == [CANONICAL], 'detail': locations},
        {'name': 'robots_discovery', 'pass': 'Allow: /' in robots and 'Disallow:' not in robots and 'Sitemap: ' + CANONICAL + 'sitemap.xml' in robots, 'detail': robots},
    ])
    node_code = "import {LABS,MATERIALS,LAB_IDS} from './src/studio/material-labs/catalog.ts'; console.log(JSON.stringify(LAB_IDS.map(id=>({id,profiles:MATERIALS[id].length,experiments:LABS[id].experiments.length}))))"
    catalog = json.loads(subprocess.check_output(['/opt/homebrew/bin/node', '--experimental-strip-types', '--input-type=module', '-e', node_code], cwd=ROOT, text=True))
    report['checks'].append({'name': 'feature_counts', 'pass': len(catalog) == 5 and all(row['profiles'] == row['experiments'] == 8 for row in catalog), 'detail': catalog})
    checkpoint = json.loads((ROOT / 'docs/design/material-labs-20260910/source-checkpoint.json').read_text())['ownedFileParity']
    parity = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == row['source'] for path, row in checkpoint.items() if path != 'index.html'}
    report['checks'].append({'name': 'unchanged_owned_runtime_sources', 'pass': all(parity.values()), 'detail': parity})
    report['pass'] = all(c['pass'] for c in report['checks'])
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'pass': report['pass'], 'checks': len(report['checks']), 'htmlSha256': report['htmlSha256'], 'failed': [c for c in report['checks'] if not c['pass']], 'output': str(args.output)}, indent=2))
    raise SystemExit(0 if report['pass'] else 1)


if __name__ == '__main__':
    main()
