// 端到端冒烟测试：复用与浏览器完全相同的 lib 管线，验证关键不变量
// 用法：npm run smoke
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, tableToCsv } from '../src/lib/csv.ts';
import { inferDimensionDefs } from '../src/lib/dimensions.ts';
import { publishTable, MIN_SUPPRESSION_GROUP } from '../src/lib/pipeline.ts';
import { Rng } from '../src/lib/rng.ts';
import type { BudgetAccount, TableDesign } from '../src/lib/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const csv = await readFile(resolve(__dirname, '../data/synthetic-population.csv'), 'utf8');
  const records = parseCsv(csv);
  check('CSV 解析 50 万行', records.length === 500000, `实际 ${records.length}`);

  const dimDefs = inferDimensionDefs(records);
  const budget: BudgetAccount = { totalEpsilon: 1, totalDelta: 1e-6, usedEpsilon: 0, usedDelta: 0 };
  const ctx = { records, dimDefs, budget, rng: new Rng(112233), operator: 'smoke-test' };

  const design: TableDesign = {
    id: 'smoke-1', name: '冒烟表 区县×年龄×教育',
    dimensions: ['district', 'ageGroup', 'education'],
    metrics: ['count', 'incomeSum', 'incomeMean'],
    mechanism: 'laplace', epsilon: 0.6, delta: 0,
    suppressThreshold: 5, incomeClip: 200000,
  };
  const { table, audit } = publishTable(design, ctx);

  // 不变量 1：非负、整数
  const kept = table.cells.filter((c) => !c.suppressed);
  check(
    '全部发布值非负',
    kept.every((c) => (c.noisyCount ?? 0) >= 0 && (c.noisyIncomeSum ?? 0) >= 0),
  );
  check(
    '全部发布值为整数',
    kept.every((c) => Number.isInteger(c.noisyCount) && Number.isInteger(c.noisyIncomeSum)),
  );

  // 不变量 2：子项加总 = 合计
  const sumCount = kept.reduce((s, c) => s + (c.noisyCount ?? 0), 0) + table.publishedSuppressedCount;
  const sumIncome = kept.reduce((s, c) => s + (c.noisyIncomeSum ?? 0), 0) + table.publishedSuppressedIncomeSum;
  check('人数子项加总=合计', sumCount === table.publishedTotalCount, `${sumCount} vs ${table.publishedTotalCount}`);
  check('收入子项加总=合计', sumIncome === table.publishedTotalIncomeSum);

  // 不变量 3：抑制桶大小 >= k 且被抑制格子无发布值
  check('抑制汇总桶 >= k', table.suppressedCellCount >= MIN_SUPPRESSION_GROUP);
  check('被抑制格子不输出单格值', table.cells.every((c) => !c.suppressed || (c.noisyCount === null && c.noisyIncomeSum === null)));

  // 不变量 4：人均收入 = 收入总额 / 计数（派生一致）
  const meanOk = kept.every(
    (c) => c.incomeMean === null || Math.abs(c.incomeMean - (c.noisyIncomeSum! / c.noisyCount!)) < 1e-9,
  );
  check('人均收入与总额/计数一致', meanOk);

  // 不变量 5：预算记账与审计
  check('预算已扣减', Math.abs(budget.usedEpsilon - 0.6) < 1e-12);
  check('审计记录操作员', audit.operator === 'smoke-test');
  check('审计剩余预算正确', Math.abs(audit.epsilonRemaining - 0.4) < 1e-12);

  // 不变量 6：大格子精度
  const large = kept.filter((c) => c.trueCount >= 1000);
  const maxRE = Math.max(...large.map((c) => c.countRelativeError ?? 0));
  check('大格子相对误差 < 5%', maxRE < 0.05, `最大 ${(maxRE * 100).toFixed(3)}%`);

  // 不变量 7：CSV 导出可被重新解析，且不含真实计数列
  const exported = tableToCsv(table);
  check('导出 CSV 含合计行', exported.includes('【合计】'));
  check('导出 CSV 含抑制桶行', exported.includes('【抑制项汇总】'));
  check('导出 CSV 不含真实收入字段名', !exported.includes('trueIncome'));
  const reParsed = exported.split(/\r?\n/).filter(Boolean);
  check('导出 CSV 行数 = 发布格子 + 桶 + 合计 + 表头',
    reParsed.length === kept.length + 3, `实际 ${reParsed.length}`);

  // 不变量 8：高斯机制路径
  const gaussDesign: TableDesign = {
    ...design, id: 'smoke-2', name: '高斯冒烟表',
    mechanism: 'gaussian', epsilon: 0.4, delta: 1e-6,
  };
  publishTable(gaussDesign, ctx);
  check('高斯表 δ 记账', Math.abs(budget.usedDelta - 1e-6) < 1e-12);
  check('高斯表累计 ε=1.0（预算恰好用完）', Math.abs(budget.usedEpsilon - 1.0) < 1e-12,
    `实际 ${budget.usedEpsilon}`);

  // 不变量 9：预算耗尽拒绝
  let rejected = false;
  try {
    publishTable({ ...design, id: 'smoke-3', epsilon: 0.01 }, ctx);
  } catch {
    rejected = true;
  }
  check('预算耗尽后拒绝新发布', rejected);

  console.log(`\n${failures === 0 ? '冒烟测试全部通过 ✅' : `有 ${failures} 项失败 ❌`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
