"""Fetch public source pages for an evidence-based CMU event-source catalog."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from html.parser import HTMLParser
import json
import os
import re
import sys
from urllib.parse import urljoin, urldefrag
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

class PageParser(HTMLParser):
    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.title, self.headings, self.links, self.parts = base, '', [], [], []
        self.stack, self.anchor, self.heading = [], None, None
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style', 'noscript'):
            self.stack.append(tag)
        if tag == 'title':
            self.in_title = True
        if tag in ('h1', 'h2', 'h3'):
            self.heading = []
        href = attrs.get('href') or (attrs.get('src') if tag == 'iframe' else None)
        if tag in ('a', 'link', 'iframe') and href:
            target = urldefrag(urljoin(self.base, href))[0]
            if target.startswith(('http:', 'https:', 'webcal:')):
                link = {'text': attrs.get('title', ''), 'url': target}
                self.links.append(link)
                if tag == 'a':
                    self.anchor = link
    def handle_endtag(self, tag):
        if self.stack and tag == self.stack[-1]:
            self.stack.pop()
        if tag == 'title':
            self.in_title = False
        if tag == 'a':
            self.anchor = None
        if tag in ('h1', 'h2', 'h3') and self.heading is not None:
            self.headings.append(' '.join(self.heading))
            self.heading = None
    def handle_data(self, data):
        text = ' '.join(data.split())
        if not text or self.stack:
            return
        self.parts.append(text)
        if getattr(self, 'in_title', False):
            self.title += text
        if self.heading is not None:
            self.heading.append(text)
        if self.anchor is not None:
            self.anchor['text'] = (self.anchor['text'] + ' ' + text).strip()[:200]

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache' / 'pages'
CACHE.mkdir(parents=True, exist_ok=True)

def fetch(url, refresh=False):
    refresh = refresh or os.environ.get('CMUEVENTS_REFRESH') == '1'
    key = sha256(url.encode()).hexdigest()[:20]
    output = CACHE / (key + '.json')
    if output.exists() and not refresh:
        return json.loads(output.read_text())
    record = {'requested_url': url, 'checked_at': datetime.now(timezone.utc).isoformat()}
    try:
        request = Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; CMUEvents source directory research)'})
        try:
            response = urlopen(request, timeout=30)
        except HTTPError as exc:
            response = exc
        content = response.read()
        record.update(status=response.status, url=response.url, content_type=response.headers.get('Content-Type', ''), size_bytes=len(content))
        if 'html' in record['content_type']:
            parser = PageParser(response.url)
            parser.feed(content.decode('utf-8', errors='replace'))
            record['title'] = parser.title
            record['headings'] = parser.headings
            record['links'] = []
            seen = set()
            for link in parser.links:
                if link['url'] not in seen:
                    seen.add(link['url'])
                    record['links'].append(link)
            record['text'] = ' '.join(parser.parts)
            (CACHE / (key + '.html')).write_bytes(content)
        else:
            record['text'] = content.decode('utf-8', errors='replace')[:200000] if re.search('text|xml|json|calendar', record['content_type']) else ''
            record['title'] = ''
            record['links'] = []
            if b'BEGIN:VCALENDAR' in content[:200]:
                record['calendar_valid'] = content.rstrip().endswith(b'END:VCALENDAR')
                record['calendar_event_count'] = content.count(b'BEGIN:VEVENT')
                name = re.search(rb'X-WR-CALNAME[^:]*:([^\r\n]+)', content)
                record['calendar_name'] = name.group(1).decode('utf-8', errors='replace') if name else ''
    except (URLError, TimeoutError, OSError) as exc:
        record.update(status=None, error=str(exc), links=[])
    output.write_text(json.dumps(record, ensure_ascii=False, indent=2))
    return record

def summary(record):
    return {k: v for k, v in record.items() if k not in ('text', 'links', 'headings')} | {
        'headings': record.get('headings', [])[:15],
        'event_links': [x for x in record.get('links', []) if re.search(r'event|calendar|seminar|colloqui|workshop|lecture|subscribe|\.ics|feed|newsletter', x['text'] + ' ' + x['url'], re.I)]
    }

if __name__ == '__main__':
    mode, *urls = sys.argv[1:]
    if mode == 'file':
        urls = json.loads(Path(urls[0]).read_text())
    with ThreadPoolExecutor(max_workers=6) as executor:
        for record in executor.map(fetch, urls):
            print(json.dumps(summary(record), ensure_ascii=False))
