// 生成 50 万合成人口并写出 CSV（纯虚构数据，仅用于演示与攻击验证）
// 用法：npm run gen:data -- [人数] [种子]
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePopulation } from '../src/lib/synthetic.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const n = Number(process.argv[2] ?? 500000);
const seed = Number(process.argv[3] ?? 20261116);
const INCOME_CLIP = 200000;

console.log(`[gen] 生成合成人口 n=${n}, seed=${seed} ...`);
const t0 = Date.now();
const records = generatePopulation({ n, seed, incomeClip: INCOME_CLIP });

const header = 'id,district,ageGroup,gender,education,occupation,householdSize,income';
const lines = records.map(
  (r) =>
    `${r.id},${r.district},${r.ageGroup},${r.gender},${r.education},${r.occupation},${r.householdSize},${r.income}`,
);
const csv = [header, ...lines].join('\n');

const outPath = resolve(__dirname, '../data/synthetic-population.csv');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, csv, 'utf8');

const meanIncome = Math.round(records.reduce((s, r) => s + r.income, 0) / records.length);
const byDistrict = new Map<string, number>();
for (const r of records) byDistrict.set(r.district, (byDistrict.get(r.district) ?? 0) + 1);

console.log(`[gen] 写出 ${outPath}（${(csv.length / 1024 / 1024).toFixed(1)} MB，耗时 ${Date.now() - t0} ms）`);
console.log(`[gen] 人均收入 ${meanIncome} 元；区县数 ${byDistrict.size}`);
console.log('[gen] 各区县人口：');
for (const [d, c] of [...byDistrict].sort((a, b) => b[1] - a[1])) {
  console.log(`       ${d}: ${c}`);
}
