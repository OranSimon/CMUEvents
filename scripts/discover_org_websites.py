"""Look for additional public event indexes linked by the official group directory."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import re
from urllib.parse import urlparse
from research import ROOT, fetch

groups = json.loads((ROOT/'research/tartanconnect-groups.json').read_text())
blocked = ('tartanconnect.cmu.edu','facebook','instagram','discord','linkedin','youtube','twitter','linktr.ee','google','microsoft','forms.','list-manage')
jobs = {}
for group in groups:
    for url in group['websites']:
        if not any(x in urlparse(url).netloc.lower() for x in blocked):
            jobs.setdefault(url, []).append(group['name'])
results = []
with ThreadPoolExecutor(max_workers=6) as pool:
    futures = {pool.submit(fetch, url): (url,names) for url,names in jobs.items()}
    for future in as_completed(futures):
        url,names = futures[future]
        page = future.result()
        links = [x for x in page.get('links',[]) if re.search(r'event|calendar|concert|show|seminar|workshop|schedule|\.ics',x['text']+' '+x['url'],re.I) and not re.search(r'\.(css|js|png|jpg|svg)(\?|$)',x['url'])]
        results.append({'orgs':names,'source_url':url,'status':page.get('status'),'url':page.get('url'),'title':page.get('title'),'links':links})
        if len(results)%25==0:
            print(f'External organization websites checked: {len(results)}/{len(jobs)}',flush=True)
(ROOT/'research/org-website-discovery.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('Finished',len(results),flush=True)
