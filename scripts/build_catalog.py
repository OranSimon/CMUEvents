"""Build the three-column catalog from individually verified public sources."""
from collections import Counter
import csv
from datetime import datetime, timezone
import json
import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from research import ROOT, fetch

DATA = ROOT/'data'
DATA.mkdir(exist_ok=True)
FIELDS = ['Department','Org','link']
calendar_departments = {
    'bio':'Mellon College of Science / Biological Sciences', 'bme':'College of Engineering / Biomedical Engineering',
    'block-center':'Heinz College', 'interdisciplinary':'Interdisciplinary', 'carnegiebosch':'College of Engineering',
    'cmist':'Dietrich College', 'universitypress':'Dietrich College / English', 'capd':'College of Engineering / Chemical Engineering',
    'data-driven-material-design':'College of Engineering', 'cerca':'College of Engineering / Civil and Environmental Engineering',
    'cas':'College of Fine Arts / Dietrich College', 'cheme':'College of Engineering / Chemical Engineering',
    'chemistry':'Mellon College of Science / Chemistry', 'cee':'College of Engineering / Civil and Environmental Engineering',
    'sv':'Global Locations / Silicon Valley', 'africa':'Global Locations / Africa', 'engineering':'College of Engineering',
    'cfa':'College of Fine Arts', 'computational-humanities':'Dietrich College', 'computing':'Office of the CIO',
    'cylab':'College of Engineering / CyLab', 'dietrich':'Dietrich College', 'ece':'College of Engineering / Electrical and Computer Engineering',
    'epp':'College of Engineering / Engineering and Public Policy', 'english':'Dietrich College / English',
    'etc':'Interdisciplinary', 'studio':'College of Fine Arts', 'heinz':'Heinz College', 'history':'Dietrich College / History',
    'hr':'Human Resources', 'ica':'College of Fine Arts', 'ideate':'Interdisciplinary', 'interfaith-calendar':'Student Affairs',
    'lcal':'Dietrich College / Languages, Cultures and Applied Linguistics', 'library':'University Libraries',
    'mfi':'College of Engineering', 'manufacturingpa':'College of Engineering', 'mcf':'College of Engineering',
    'mse':'College of Engineering / Materials Science and Engineering', 'math':'Mellon College of Science / Mathematical Sciences',
    'meche':'College of Engineering / Mechanical Engineering', 'mcs':'Mellon College of Science', 'mesh':'College of Engineering',
    'ni':'Interdisciplinary', 'next':'College of Engineering', 'faculty-office':'Office of the Provost',
    'pita':'College of Engineering', 'philosophy':'Dietrich College / Philosophy', 'physics':'Mellon College of Science / Physics',
    'psc':'Interdisciplinary', 'psychology':'Dietrich College / Psychology', 'public-art':'College of Fine Arts',
    'cbd':'School of Computer Science / Computational Biology Department', 'architecture':'College of Fine Arts / School of Architecture',
    'art':'College of Fine Arts / School of Art', 'design':'College of Fine Arts / School of Design',
    'drama':'College of Fine Arts / School of Drama', 'music':'College of Fine Arts / School of Music',
    'sds':'Dietrich College / Social and Decision Sciences', 'statistics-datascience':'Dietrich College / Statistics and Data Science',
    'student-success':'Student Affairs', 'student-affairs':'Student Affairs', 'studyabroad':'Enrollment Management',
    'tepper':'Tepper School of Business', 'energy':'Interdisciplinary', 'academic-calendar':'Enrollment Management',
    'admission':'Enrollment Management', 'admitted-students':'Enrollment Management', 'athletics-home':'Student Affairs',
    'enrollment-financial-deadlines':'Enrollment Management', 'afretec':'Global Locations / Africa',
    'ai-sdm':'Interdisciplinary', 'aimsec':'Interdisciplinary',
}

def group_department(category, campus='Pittsburgh'):
    if campus=='Qatar':
        return 'Global Locations / Qatar / '+(category or 'Student Organizations')
    if 'Tepper' in category:
        return 'Tepper School of Business / '+category.split(' - ')[0]
    if 'Student Government Recognized' in category:
        return 'Student Organizations'
    if 'Fraternity' in category:
        return 'Fraternity and Sorority Chapters'
    if 'Student Governance' in category:
        return 'Student Governance'
    if 'Department Sponsored' in category:
        return 'Department-sponsored Organizations'
    return 'University Offices'

def canonical(url):
    p=urlparse(url)
    path=p.path
    if p.hostname=='tartanconnect.cmu.edu' and '/ical/' not in path:
        path=path.lower()
    if path.endswith('/index.html'):
        path=path[:-10]
    query=urlencode([(k,v) for k,v in parse_qsl(p.query,keep_blank_values=True) if not k.startswith('utm_')])
    return urlunparse((p.scheme,p.netloc.lower(),path, p.params,query,''))

catalog=[]
unavailable=[]
def add(row,kind,record,note='',discovered_on=None):
    entry={k:row[k].strip() for k in FIELDS}
    entry['Org']=entry['Org'].replace('CinÃ©, CrÃªpes & Copains','Ciné, Crêpes & Copains')
    entry.update(source_kind=kind,checked_at=record.get('checked_at'),http_status=record.get('status'),
                 title=record.get('title') or record.get('calendar_name') or '',note=note)
    if discovered_on:
        entry['discovered_on']=discovered_on
    if record.get('calendar_event_count') is not None:
        entry['calendar_event_count']=record['calendar_event_count']
    entry['anonymous_access_verified']=True
    catalog.append(entry)

def reject(row,record,reason):
    unavailable.append({**row,'http_status':record.get('status'),'checked_at':record.get('checked_at'),'reason':reason})

for entry in json.loads((ROOT/'research/directory-verification.json').read_text()):
    if entry['kind']=='university':
        slug=urlparse(entry['requested_url']).path.strip('/').split('/')[0]
        assert slug in calendar_departments,slug
        row={'Department':calendar_departments[slug],'Org':entry['source']['text']+' — CMU calendar','link':entry['requested_url']}
        if entry['valid']:
            add(row,'university_calendar',entry,'Official unit calendar. Content is loaded dynamically; a public source does not imply unrestricted attendance.','https://events.cmu.edu/directory/')
        else:
            reject(row,entry,'Official calendar endpoint was not verified.')
    else:
        group=entry['source']
        row={'Department':group_department(group['category']),'Org':group['name']+' — TartanConnect events','link':entry['requested_url']}
        if entry['valid']:
            note='Public organization-specific event listing.'
            if entry['empty']:
                note+=' Anonymous HTML currently displays no upcoming events; retained as a recurring source, not evidence of active programming.'
            add(row,'organization_listing',entry,note,'https://tartanconnect.cmu.edu/club_signup?view=all')
        else:
            reject(row,entry,'Organization event page redirected, failed, or did not expose an organization-specific event list.')

manual=list(csv.DictReader((ROOT/'research/manual-sources.tsv').open(),delimiter='\t'))
for row in manual:
    page=fetch(row['link'])
    isfeed=bool(re.search(r'\.ics(?:$|\?)|[?&]ical=1(?:$|&)',row['link']))
    if page.get('status')==200 and isfeed and 'calendar_valid' not in page:
        page=fetch(row['link'],refresh=True)
    if page.get('status')!=200:
        reject(row,page,page.get('error') or 'Endpoint returned a non-200 response; a protected redirect or anti-bot block is not evidence that the source does not exist.')
        continue
    if isfeed and not page.get('calendar_valid'):
        reject(row,page,'Advertised calendar URL did not return a complete VCALENDAR file.')
        continue
    if re.search(r'/saml/|/login\b',page.get('url','')):
        reject(row,page,'Redirects to authentication.')
        continue
    kind='ical_feed' if isfeed else ('rss_feed' if 'RSS' in row['Org'] else ('newsletter_archive' if 'newsletter archive' in row['Org'] else 'event_listing'))
    add(row,kind,page,'Public list, calendar, seminar series or newsletter index. Registration and attendance conditions vary by event.')

feed_records=json.loads((ROOT/'research/public-feed-verification.json').read_text())
for page in feed_records:
    row={'Department':group_department(page['category'],page['campus']), 'Org':page['name']+' — iCalendar', 'link':page['url']}
    if page['category']=='School-wide calendar':
        row['Department']='Student Affairs' if page['campus']=='Pittsburgh' else 'Global Locations / Qatar'
    if page.get('status')==200 and page.get('calendar_valid'):
        add(row,'ical_feed',page,'Anonymous public group feed. The event count is the number of VEVENT records returned, including any historical or canceled records.',page['discovered_on'])
    else:
        reject(row,page,'Advertised public group feed did not return a complete calendar (commonly HTTP 404).')

for page in json.loads((ROOT/'research/additional-subscriptions.json').read_text()):
    row={k:page[k] for k in FIELDS}
    isfeed=bool(re.search(r'\.ics(?:$|\?)|[?&]ical=1(?:$|&)',row['link']))
    if page['status']==200 and ((isfeed and page['calendar_valid']) or (not isfeed and 'Info Page' in (page['title'] or ''))):
        add(row,'ical_feed' if isfeed else 'mailing_list',page,'Subscription source advertised on the organizer’s public page; this catalog does not subscribe the user.',page['discovered_on'])
    elif isfeed or '/listinfo/' in row['link']:
        reject(row,page,'Linked subscription endpoint could not be verified as a public feed or public subscription information page.')

seen=set()
deduped=[]
for row in catalog:
    key=canonical(row['link'])
    if key not in seen:
        seen.add(key)
        deduped.append(row)
catalog=sorted(deduped,key=lambda r:(r['Department'].casefold(),r['Org'].casefold(),r['link']))
for row in catalog:
    assert all(row[k] for k in FIELDS)
    assert urlparse(row['link']).scheme in ('http','https')
    assert not re.search(r'action=TEMPLATE|/event/\d|/calendar/20\d\d-\d\d-\d\d|\[CONTENT|\{\{',row['link']),row['link']

with (DATA/'event_sources.csv').open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=FIELDS,extrasaction='ignore',lineterminator='\n')
    writer.writeheader()
    writer.writerows(catalog)
(DATA/'event_sources.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2))
(ROOT/'research/unavailable-sources.json').write_text(json.dumps(unavailable,ensure_ascii=False,indent=2))
summary={'verified_on':'2026-10-20','catalog_entries':len(catalog),'source_kinds':dict(Counter(x['source_kind'] for x in catalog)),
         'departments':dict(sorted(Counter(x['Department'] for x in catalog).items())),
         'official_calendar_directory_entries':73,'public_group_feed_links_checked':len(feed_records),
         'valid_group_feeds':sum(bool(x['calendar_valid']) for x in feed_records),
         'manual_candidates_checked':len(manual),'unavailable_or_unverified_candidates':len(unavailable)}
(DATA/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in summary.items() if k!='departments'},indent=2))
