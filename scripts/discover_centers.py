"""Find additional event sources from CMU's school-level center directories."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import json
import re
from urllib.parse import urlparse
from research import ROOT, fetch

directories = {
    'College of Engineering': 'https://engineering.cmu.edu/research/centers.html',
    'Dietrich College': 'https://www.cmu.edu/dietrich/research/research-centers.html',
    'Heinz College': 'https://www.heinz.cmu.edu/faculty-research/research-centers',
    'School of Computer Science': 'https://www.cs.cmu.edu/research/institutes-centers',
    'College of Fine Arts': 'https://cfa.cmu.edu/research-and-creative-practice/research-centers-and-labs',
}
hubs = []
for department, url in directories.items():
    page = fetch(url)
    for link in page.get('links', []):
        text, target = link['text'], link['url']
        if re.search(r'Center|Institute|Laborator|Coalition|Consortium|^Learn [mM]ore about|^Catalyst|^Delphi|^Robotics, Embodied|^Responsible AI', text) and not re.search(r'news/|news-|facebook|wikipedia|amazon\.science|/research-and-creativity/|/education/|/academics/|/giving', target):
            name = text.split(' The ')[0]
            if len(name) > 120 or text == 'Learn More' or text in ('Centers & Institutes', 'Research: Institutes & Centers'):
                continue
            hubs.append({'Department':department,'Org':name.removeprefix('Learn more about '),'link':target})
seen = {x['link'].rstrip('/') for x in csv.DictReader((ROOT/'research/discovery-hubs.tsv').open(),delimiter='\t')}
hubs = [x for x in hubs if x['link'].rstrip('/') not in seen and not seen.add(x['link'].rstrip('/'))]
results = []
with ThreadPoolExecutor(max_workers=6) as pool:
    jobs = {pool.submit(fetch, x['link']): x for x in hubs}
    for future in as_completed(jobs):
        source, record = jobs[future], future.result()
        links = [x for x in record.get('links', []) if re.search(r'event|calendar|seminar|colloqui|workshop|lecture|subscribe|newsletter|exhibition|\.ics|feed',x['text']+' '+x['url'],re.I) and not re.search(r'\.(css|js|png|jpg|svg)(\?|$)',x['url'])]
        results.append({'source':source,'status':record.get('status'),'title':record.get('title'),'url':record.get('url'),'links':links})
        print(source['Org'],record.get('status'),len(links),flush=True)
(ROOT/'research/center-hub-discovery.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('Centers checked:',len(results),flush=True)
