import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'outputs', '01a15b3a-aa11-79f0-96c7-fdcfed7eef2f');
await fs.mkdir(outputDir, { recursive: true });
const rows = JSON.parse(await fs.readFile(path.join(root, 'data/event_sources.json'), 'utf8'));
const csv = (await fs.readFile(path.join(root, 'data/event_sources.csv'), 'utf8')).replace(/^\uFEFF/, '');
const workbook = await Workbook.fromCSV(csv, { sheetName: 'Sources' });
const sheet = workbook.worksheets.getItem('Sources');
const lastRow = rows.length + 1;
const used = sheet.getRange(`A1:C${lastRow}`);
sheet.showGridLines = false;
sheet.tabColor = '#C41230';
used.format.font = { name: 'Arial', size: 10, color: '#222222' };
used.format.verticalAlignment = 'center';
used.format.wrapText = true;
used.format.rowHeight = 36;
sheet.getRange(`A1:A${lastRow}`).format.columnWidth = 47;
sheet.getRange(`B1:B${lastRow}`).format.columnWidth = 79;
sheet.getRange(`C1:C${lastRow}`).format.columnWidth = 111;
sheet.freezePanes.freezeRows(1);
sheet.freezePanes.freezeColumns(1);
const table = sheet.tables.add(`A1:C${lastRow}`, true, 'CMUEventSources');
table.style = 'TableStyleLight9';
table.showFilterButton = true;
sheet.getRange('A1:C1').format = {
  fill: '#A6192E',
  font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  rowHeight: 28,
};
sheet.getRange(`C2:C${lastRow}`).format.font = { name: 'Arial', size: 10, color: '#0563C1' };
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const lines = Math.max(Math.ceil(row.Department.length / 46), Math.ceil(row.Org.length / 77), Math.ceil(row.link.length / 106));
  sheet.getRange(`A${i+2}:C${i+2}`).format.rowHeight = Math.max(32, 15 * lines + 10);
}
workbook.recalculate();
const inspection = await workbook.inspect({ kind: 'table', range: 'Sources!A1:C6', include: 'values,formulas', tableMaxRows: 6, tableMaxCols: 3, maxChars: 1800 });
console.log(inspection.ndjson);
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 20 }, maxChars: 1000 });
console.log(errors.ndjson);
const preview = await workbook.render({ sheetName: 'Sources', range: process.argv[2] || 'A1:C16', scale: 1.4, format: 'png' });
await fs.mkdir(path.join(root, '.cache/previews'), { recursive: true });
await fs.writeFile(path.join(root, '.cache/previews/sources.png'), new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, 'CMU_Event_Sources.xlsx'));
console.log(JSON.stringify({ rows: rows.length, output: path.join(outputDir, 'CMU_Event_Sources.xlsx') }));
