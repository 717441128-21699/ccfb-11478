// 极简 CSV 解析/序列化(支持引号转义)
import type { Row } from './types.js';

export function parseCsv(text: string): { header: string[]; rows: Row[] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      record.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      if (record.length > 1 || record[0] !== '') records.push(record);
      record = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  if (records.length === 0) return { header: [], rows: [] };
  const header = records[0].map((h) => h.trim());
  const rows: Row[] = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.length !== header.length) continue; // 跳过畸形行
    const row: Row = {};
    for (let c = 0; c < header.length; c++) {
      const v = rec[c];
      const num = Number(v);
      row[header[c]] = v !== '' && !Number.isNaN(num) ? num : v;
    }
    rows.push(row);
  }
  return { header, rows };
}

export function toCsv(header: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return lines.join('\n') + '\n';
}
