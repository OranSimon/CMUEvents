"""Discover and validate feeds and mailing-list pages linked by accepted source candidates."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import json
import re
from urllib.parse import parse_qs, quote, urlparse
from research import ROOT, fetch

sources=list(csv.DictReader((ROOT/'research/manual-sources.tsv').open(),delimiter='\t'))
jobs={}
for row in sources:
    page=fetch(row['link'])
    if page.get('status')!=200:
        continue
    for link in page.get('links',[]):
        target=link['url']
        if re.search(r'/mailman/listinfo/|/subscribe[^/]*$|\.ics(?:$|\?)|[?&]ical=1(?:$|&)',target) and not re.search('google.com/calendar/render|comments/feed|stylesheet',target):
            jobs.setdefault(target,{'Department':row['Department'],'Org':row['Org']+' — subscription','link':target,'discovered_on':row['link']})
        if urlparse(target).netloc in ('calendar.google.com','www.google.com') and '/calendar/' in target:
            query=parse_qs(urlparse(target).query)
            for calendar in query.get('src',[]):
                if '@' not in calendar or re.search(r'^en\.|holiday',calendar):
                    continue
                feed='https://calendar.google.com/calendar/ical/'+quote(calendar,safe='')+'/public/basic.ics'
                jobs.setdefault(feed,{'Department':row['Department'],'Org':row['Org']+' — iCalendar','link':feed,'discovered_on':row['link'],'advertised_url':target})
results=[]
with ThreadPoolExecutor(max_workers=6) as pool:
    futures={pool.submit(fetch,u):r for u,r in jobs.items()}
    for future in as_completed(futures):
        row,page=futures[future],future.result()
        isfeed=bool(re.search(r'\.ics(?:$|\?)|[?&]ical=1(?:$|&)',row['link']))
        if isfeed and page.get('status')==200 and 'calendar_valid' not in page:
            page=fetch(row['link'],refresh=True)
        results.append(row|{k:page.get(k) for k in ('status','title','calendar_valid','calendar_event_count','content_type','checked_at')})
(ROOT/'research/additional-subscriptions.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('Linked subscriptions checked',len(results),'valid calendars',sum(bool(x['calendar_valid']) for x in results),'HTTP 200',sum(x['status']==200 for x in results),flush=True)
