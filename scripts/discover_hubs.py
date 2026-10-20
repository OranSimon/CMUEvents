"""Discover event-source links from official organizational home pages."""
import csv
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from research import ROOT, fetch

rows = list(csv.DictReader((ROOT / 'research/discovery-hubs.tsv').open(), delimiter='\t'))
results = []
with ThreadPoolExecutor(max_workers=6) as pool:
    jobs = {pool.submit(fetch, x['link']): x for x in rows}
    for future in as_completed(jobs):
        source, record = jobs[future], future.result()
        matches = [x for x in record.get('links', []) if re.search(r'event|calendar|seminar|colloqui|workshop|lecture|newsletter|subscribe|exhibition|performance|\.ics|feed', x['text'] + ' ' + x['url'], re.I) and not re.search(r'\.(css|js|png|jpg|svg)(\?|$)', x['url'])]
        results.append({'source': source, 'status': record.get('status'), 'title': record.get('title'), 'url': record.get('url'), 'links': matches})
        print(json.dumps({'org':source['Org'],'status':record.get('status'),'links':matches},ensure_ascii=False),flush=True)
(ROOT / 'research/hub-discovery.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
