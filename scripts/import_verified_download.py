"""Parse a public HTML download already verified with curl's certificate checks."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
from research import CACHE, PageParser

url,path = sys.argv[1:]
content=Path(path).read_bytes()
page=PageParser(url)
page.feed(content.decode('utf-8',errors='replace'))
record={'requested_url':url,'url':url,'status':200,'content_type':'text/html','checked_at':datetime.now(timezone.utc).isoformat(),'fetch_method':'curl with default TLS verification','title':page.title,'headings':page.headings,'text':' '.join(page.parts),'links':page.links,'size_bytes':len(content)}
key=sha256(url.encode()).hexdigest()[:20]
(CACHE/(key+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2))
(CACHE/(key+'.html')).write_bytes(content)
print(page.title,page.headings[:10])
print(record['text'][:1600])
print([x for x in page.links if re.search(r'calendar|ical|\.ics|seminar|listinfo',x['url'],re.I)][:10])
