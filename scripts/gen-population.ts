// 生成 50 万人合成人口 CSV:data/population.csv
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCsv } from '../src/core/csv.js';
import { generatePopulation, POPULATION_HEADER } from '../src/synth/population.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const n = Number(process.argv[2] ?? 500_000);

console.log(`生成 ${n.toLocaleString()} 条合成人口记录…`);
const t0 = Date.now();
const rows = generatePopulation(n);
const csv = toCsv(
  POPULATION_HEADER,
  rows.map((r) => [
    r.id, r.county, r.sex, r.ageGroup, r.education, r.income,
  ])
);
mkdirSync(join(root, 'data'), { recursive: true });
const out = join(root, 'data', 'population.csv');
writeFileSync(out, csv, 'utf8');
console.log(
  `完成:${out}  (${(csv.length / 1024 / 1024).toFixed(1)} MB, ${Date.now() - t0} ms)`
);
