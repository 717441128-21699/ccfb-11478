// CSV 解析/序列化（无第三方依赖），仅在本机处理，不发起任何网络请求
import type { PersonRecord, PublishedTable, TableCell } from './types';

const REQUIRED_COLUMNS: (keyof PersonRecord)[] = [
  'id', 'district', 'ageGroup', 'gender', 'education', 'occupation', 'householdSize', 'income',
];

/** 支持引号包裹、逗号转义、CRLF 的最小 CSV 解析 */
export function parseCsv(text: string): PersonRecord[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }

  if (rows.length < 2) throw new Error('CSV 内容为空或缺少数据行');
  const header = rows[0].map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`CSV 缺少必需列：${missing.join('、')}`);

  const col = (name: keyof PersonRecord) => header.indexOf(name);
  const out: PersonRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    out.push({
      id: cells[col('id')]?.trim() ?? `row-${r}`,
      district: cells[col('district')]?.trim() ?? '',
      ageGroup: cells[col('ageGroup')]?.trim() ?? '',
      gender: cells[col('gender')]?.trim() ?? '',
      education: cells[col('education')]?.trim() ?? '',
      occupation: cells[col('occupation')]?.trim() ?? '',
      householdSize: Number(cells[col('householdSize')]) || 1,
      income: Number(cells[col('income')]) || 0,
    });
  }
  return out;
}

function csvEscape(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 把已发布表导出为 CSV（只含加噪/抑制后的发布值，不含任何真实明细） */
export function tableToCsv(table: PublishedTable): string {
  const dimHeaders = table.dimDefs.map((d) => d.label);
  const header = [
    ...dimHeaders,
    '发布人数',
    '发布收入总额(元)',
    '人均收入(元)',
    '状态',
  ];
  const lines: string[] = [header.map(csvEscape).join(',')];

  const render = (c: TableCell, status: string) =>
    [
      ...c.dimValues,
      c.noisyCount,
      c.noisyIncomeSum,
      c.incomeMean === null ? null : Math.round(c.incomeMean),
      status,
    ]
      .map(csvEscape)
      .join(',');

  for (const c of table.cells) {
    if (!c.suppressed) lines.push(render(c, '发布'));
  }
  const pooled: TableCell = {
    key: '__suppressed_pool__',
    dimValues: new Array(table.dimDefs.length).fill('【抑制项汇总】'),
    trueCount: table.trueSuppressedCount,
    noisyCount: table.publishedSuppressedCount,
    trueIncomeSum: table.trueSuppressedIncomeSum,
    noisyIncomeSum: table.publishedSuppressedIncomeSum,
    incomeMean:
      table.publishedSuppressedCount > 0
        ? table.publishedSuppressedIncomeSum / table.publishedSuppressedCount
        : null,
    suppressed: true,
  };
  lines.push(render(pooled, '抑制汇总'));
  lines.push(
    [
      ...new Array(table.dimDefs.length).fill('【合计】'),
      table.publishedTotalCount,
      table.publishedTotalIncomeSum,
      Math.round(table.publishedTotalIncomeSum / table.publishedTotalCount),
      '合计',
    ]
      .map(csvEscape)
      .join(','),
  );
  return lines.join('\r\n');
}
