"""Add native XLSX hyperlinks, a feature absent from the bundled authoring API."""
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

root=Path(__file__).resolve().parents[1]
file=Path(sys.argv[1])
rows=json.loads((root/'data/event_sources.json').read_text())
MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG='http://schemas.openxmlformats.org/package/2006/relationships'
ET.register_namespace('',MAIN)
ET.register_namespace('r',REL)
with ZipFile(file) as z:
    contents={n:z.read(n) for n in z.namelist()}
sheet=ET.fromstring(contents['xl/worksheets/sheet1.xml'])
rels_path='xl/worksheets/_rels/sheet1.xml.rels'
rels=ET.fromstring(contents[rels_path]) if rels_path in contents else ET.Element(f'{{{PKG}}}Relationships')
for existing in list(rels):
    if existing.get('Type','').endswith('/hyperlink'):
        rels.remove(existing)
old=sheet.find(f'{{{MAIN}}}hyperlinks')
if old is not None:
    sheet.remove(old)
links=ET.Element(f'{{{MAIN}}}hyperlinks')
for i,row in enumerate(rows,2):
    rid=f'rIdSourceLink{i}'
    cell=sheet.find(f'{{{MAIN}}}sheetData/{{{MAIN}}}row[@r="{i}"]/{{{MAIN}}}c[@r="C{i}"]')
    assert cell is not None and cell.find(f'{{{MAIN}}}f') is None
    ET.SubElement(links,f'{{{MAIN}}}hyperlink',{'ref':f'C{i}',f'{{{REL}}}id':rid})
    ET.SubElement(rels,f'{{{PKG}}}Relationship',{'Id':rid,'Type':REL+'/hyperlink','Target':row['link'],'TargetMode':'External'})
after_links={'printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','drawing','legacyDrawing','tableParts','extLst'}
position=next((i for i,x in enumerate(sheet) if x.tag.split('}')[-1] in after_links),len(sheet))
sheet.insert(position,links)
contents['xl/worksheets/sheet1.xml']=ET.tostring(sheet,encoding='utf-8',xml_declaration=True)
contents[rels_path]=ET.tostring(rels,encoding='utf-8',xml_declaration=True)
temporary=file.with_suffix('.tmp.xlsx')
with ZipFile(temporary,'w',compression=8) as z:
    for name,content in contents.items():
        z.writestr(name,content)
temporary.replace(file)
with ZipFile(file) as z:
    assert z.testzip() is None
    saved=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    assert len(saved.find(f'{{{MAIN}}}hyperlinks'))==len(rows)
print(f'Verified {len(rows)} native hyperlinks in {file}')
