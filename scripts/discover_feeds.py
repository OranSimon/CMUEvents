"""Verify anonymous public group calendar feeds advertised by CMU platforms."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
from html import unescape
import json
import re
from urllib.parse import urlparse
from research import ROOT, CACHE, PageParser, fetch

HELPERS = {
    'Pittsburgh': 'https://tartanconnect.cmu.edu/ics_helper?TB_iframe=true&embed=1&height=550&modal=true&mode=set&width=850',
    'Qatar': 'https://scottyconnect.qatar.cmu.edu/ics_helper?TB_context=Subscribe_To_Calendars&TB_iframe=true&embed=1&height=550&modal=true&mode=set&width=850',
}
feeds = []
for campus, url in HELPERS.items():
    helper = fetch(url)
    html = (CACHE/(sha256(url.encode()).hexdigest()[:20]+'.html')).read_text()
    for block in re.findall(r'<tr\b[^>]*>(.*?)</tr>',html,re.S|re.I):
        parser = PageParser(url)
        parser.feed(block)
        links = [x for x in parser.links if x['url'].startswith('https:') and urlparse(x['url']).hostname == urlparse(url).hostname and re.search(r'/ical/[^?]+\.ics$',x['url'])]
        if not links:
            continue
        cell = re.search(r'<td[^>]*>(.*?)</td>',block,re.S|re.I)
        if not cell:
            continue
        parts = re.split(r'<br\s*/?>',cell.group(1),maxsplit=1,flags=re.I)
        clean = lambda s: ' '.join(unescape(re.sub(r'<[^>]+>', '',s)).split())
        name = clean(parts[0])
        category = clean(parts[1]) if len(parts)>1 else 'School-wide calendar'
        feeds.append({'campus':campus,'name':name,'category':category,'url':links[0]['url'],'discovered_on':url})
print('Public feed links found:',len(feeds),flush=True)
results = []
with ThreadPoolExecutor(max_workers=6) as pool:
    jobs={pool.submit(fetch,x['url']):x for x in feeds}
    for future in as_completed(jobs):
        source,page=jobs[future],future.result()
        results.append(source|{k:page.get(k) for k in ['status','content_type','calendar_valid','calendar_event_count','calendar_name','checked_at','size_bytes']})
        if len(results)%50==0:
            print(f'Public feeds checked: {len(results)}/{len(feeds)}',flush=True)
            (ROOT/'research/public-feed-verification.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
(ROOT/'research/public-feed-verification.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('Finished',len(results),'valid',sum(bool(x['calendar_valid']) for x in results),flush=True)
