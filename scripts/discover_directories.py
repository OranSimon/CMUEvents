"""Enumerate the official calendar directory and public TartanConnect groups."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
from html import unescape
import json
import re
from research import ROOT, CACHE, PageParser, fetch

OUT = ROOT / 'research'
OUT.mkdir(exist_ok=True)

directory = fetch('https://events.cmu.edu/directory/')
calendars = [x for x in directory['links'] if x['url'].endswith('/all')]
(OUT / 'university-calendar-directory.json').write_text(json.dumps(calendars, ensure_ascii=False, indent=2))

url = 'https://tartanconnect.cmu.edu/club_signup?view=all'
fetch(url)
html = (CACHE / (sha256(url.encode()).hexdigest()[:20] + '.html')).read_text()
groups = []
for block in re.split(r'<li class="list-group-item"', html)[1:]:
    block = block.split('</fieldset>')[0]
    parser = PageParser(url)
    parser.feed(block)
    if not parser.headings:
        continue
    name = parser.headings[0]
    match = re.search(r'https://tartanconnect\.cmu\.edu/([^/"?]+)/club_signup\.aspx', block)
    if not match:
        match = re.search(r'href="https://tartanconnect\.cmu\.edu/([^/"?]+)/(?:home/)?"', block)
    if not match:
        continue
    kind = re.search(r'<p class="h5 media-heading grey-element">(.*?)</p>', block, re.S)
    category = re.sub(r'\s+', ' ', re.sub('<[^>]+>', '', kind.group(1))).strip() if kind else ''
    sites = [x['url'] for x in parser.links if not re.search(r'club_signup|send_message', x['url'])]
    groups.append({'name': name, 'category': unescape(category), 'slug': match.group(1), 'websites': list(dict.fromkeys(sites))})
groups = list({g['slug'].lower(): g for g in groups}.values())
(OUT / 'tartanconnect-groups.json').write_text(json.dumps(groups, ensure_ascii=False, indent=2))
print(f'Official calendars: {len(calendars)}; TartanConnect groups with public route identifiers: {len(groups)}', flush=True)

jobs = [(x['url'], 'university', x) for x in calendars]
jobs += [(f"https://tartanconnect.cmu.edu/{g['slug']}/events/", 'tartanconnect', g) for g in groups]
records = []
with ThreadPoolExecutor(max_workers=6) as executor:
    futures = {executor.submit(fetch, url): (kind, source) for url, kind, source in jobs}
    for future in as_completed(futures):
        kind, source = futures[future]
        result = future.result()
        text = result.get('text', '')
        valid = result.get('status') == 200 and (
            ('Events Calendar:' in text and source['text'] in text) if kind == 'university' else
            ('Events - ' in result.get('title', '') and 'Events' in result.get('headings', []) and source['name'].lower().replace('"', '')[:12] in text.lower().replace('"', ''))
        )
        records.append({'kind': kind, 'source': source, 'url': result.get('url'), 'requested_url': result['requested_url'], 'status': result.get('status'), 'title': result.get('title'), 'checked_at': result['checked_at'], 'valid': valid, 'empty': 'There are no upcoming events' in text, 'event_links': [x for x in result.get('links', []) if re.search(r'/events|calendar|ics|feed|newsletter', x['url'], re.I)]})
        if len(records) % 30 == 0:
            print(f'Checked {len(records)}/{len(jobs)}; accepted {sum(r["valid"] for r in records)}', flush=True)
            (OUT / 'directory-verification.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))
(OUT / 'directory-verification.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))
print(f'Finished {len(records)}; accepted {sum(r["valid"] for r in records)}', flush=True)
