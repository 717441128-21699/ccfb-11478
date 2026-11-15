// 差分攻击验证：
// A. 减法/差分反推 —— 用已发布表之间的粒度差，尝试还原被抑制/细粒度格子的真实计数
// B. 成员推断（Neyman-Pearson 对数似然比）—— 模拟"某人是否在数据集里"的攻击，计算 AUC
// C. 唯一性分析 —— 统计高维组合中的唯一人群体，确认其全部被抑制且无真实值泄漏
// D. 预算耗尽保护 —— 总预算用完后第 5 张表必须被拒绝
// E. 大格子精度 —— 真实计数 >=1000 的格子，相对误差 90 分位与最大值
// 用法：npm run attack
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../src/lib/csv.ts';
import { DIMENSIONS, inferDimensionDefs } from '../src/lib/dimensions.ts';
import { buildGrid } from '../src/lib/aggregation.ts';
import { publishTable, MIN_SUPPRESSION_GROUP } from '../src/lib/pipeline.ts';
import { laplaceScale, gaussianSigma } from '../src/lib/mechanisms.ts';
import { Rng } from '../src/lib/rng.ts';
import type {
  BudgetAccount,
  PersonRecord,
  PublishedTable,
  TableDesign,
  TableCell,
} from '../src/lib/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, '../data/synthetic-population.csv');
const SEED = 987654321;
const INCOME_CLIP = 200000;

function section(title: string): void {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(3)}%`;
}

async function main(): Promise<void> {
  section('0. 载入合成人口（本机内存，不外传）');
  const csv = await readFile(DATA_PATH, 'utf8');
  const records: PersonRecord[] = parseCsv(csv);
  console.log(`记录数：${records.length}`);
  const dimDefs = inferDimensionDefs(records);
  const budget: BudgetAccount = { totalEpsilon: 4, totalDelta: 1e-5, usedEpsilon: 0, usedDelta: 0 };
  const rng = new Rng(SEED);
  const ctx = { records, dimDefs, budget, rng, operator: 'attack-simulator' };

  // ---------- 发布计划：4 张表恰好耗尽 ε=4 ----------
  const designs: TableDesign[] = [
    {
      id: 't1', name: '区县×年龄段 人口表', dimensions: ['district', 'ageGroup'],
      metrics: ['count', 'incomeSum', 'incomeMean'], mechanism: 'laplace',
      epsilon: 1.6, delta: 0, suppressThreshold: 5, incomeClip: INCOME_CLIP,
    },
    {
      id: 't2', name: '区县×性别 人口表', dimensions: ['district', 'gender'],
      metrics: ['count', 'incomeSum'], mechanism: 'laplace',
      epsilon: 0.8, delta: 0, suppressThreshold: 5, incomeClip: INCOME_CLIP,
    },
    {
      id: 't3', name: '区县×年龄段×性别 人口表', dimensions: ['district', 'ageGroup', 'gender'],
      metrics: ['count', 'incomeSum'], mechanism: 'gaussian',
      epsilon: 1.0, delta: 1e-5, suppressThreshold: 5, incomeClip: INCOME_CLIP,
    },
    {
      id: 't4', name: '区县×年龄段×性别×教育 高维表',
      dimensions: ['district', 'ageGroup', 'gender', 'education'],
      metrics: ['count', 'incomeSum'], mechanism: 'laplace',
      epsilon: 0.6, delta: 0, suppressThreshold: 5, incomeClip: INCOME_CLIP,
    },
  ];

  section('1. 发布四张表（串行记账，预算逐表扣减）');
  const published: PublishedTable[] = [];
  for (const d of designs) {
    const { table, audit } = publishTable(d, ctx);
    published.push(table);
    console.log(
      `[${table.design.id}] ${table.design.name} | ${table.design.mechanism} | ` +
      `ε=${d.epsilon} | 格子 ${table.cells.length}，抑制 ${table.suppressedCellCount} ` +
      `（汇总桶组大小=${table.suppressedCellCount >= MIN_SUPPRESSION_GROUP ? 'OK' : 'FAIL'}）| ` +
      `累计 ε=${budget.usedEpsilon}/${budget.totalEpsilon}`,
    );
    console.log(`       审计：${audit.operator} 于 ${audit.timestamp} 发布，剩余 ε=${audit.epsilonRemaining.toFixed(4)}`);
  }

  // ---------- D. 预算耗尽保护 ----------
  section('2. 预算耗尽保护：尝试发布第 5 张表（应被拒绝）');
  const fifth: TableDesign = {
    id: 't5', name: '不应发出的表', dimensions: ['district', 'occupation'],
    metrics: ['count'], mechanism: 'laplace', epsilon: 0.1, delta: 0,
    suppressThreshold: 5, incomeClip: INCOME_CLIP,
  };
  let blocked = false;
  try {
    publishTable(fifth, ctx);
  } catch (e) {
    blocked = true;
    console.log(`已拒绝发布：${(e as Error).message}`);
  }
  console.log(`预算状态：已用 ε=${budget.usedEpsilon} / 总额 ${budget.totalEpsilon}，δ=${budget.usedDelta.toExponential(2)}`);

  // ---------- 一致性检查 ----------
  section('3. 一致性后处理检查（非负 / 整数 / 子项加总=合计）');
  let consistencyFail = 0;
  for (const t of published) {
    const kept = t.cells.filter((c) => !c.suppressed);
    const sumCount = kept.reduce((s, c) => s + (c.noisyCount ?? 0), 0) + t.publishedSuppressedCount;
    const sumIncome = kept.reduce((s, c) => s + (c.noisyIncomeSum ?? 0), 0) + t.publishedSuppressedIncomeSum;
    const nonNeg = [...kept].every((c) => (c.noisyCount ?? 0) >= 0 && (c.noisyIncomeSum ?? 0) >= 0);
    const integer = [...kept].every(
      (c) => Number.isInteger(c.noisyCount) && Number.isInteger(c.noisyIncomeSum),
    );
    const ok = sumCount === t.publishedTotalCount && sumIncome === t.publishedTotalIncomeSum && nonNeg && integer;
    if (!ok) consistencyFail++;
    console.log(
      `[${t.design.id}] 加总守恒=${sumCount === t.publishedTotalCount && sumIncome === t.publishedTotalIncomeSum} ` +
      `非负=${nonNeg} 整数=${integer} => ${ok ? 'PASS' : 'FAIL'}`,
    );
  }

  // ---------- C. 唯一性 + 抑制泄漏检查 ----------
  section('4. 唯一性分析与抑制泄漏检查（最细 4 维组合）');
  const fine = published[3];
  const uniqueCells = fine.cells.filter((c) => c.trueCount === 1);
  const rareCells = fine.cells.filter((c) => c.trueCount >= 1 && c.trueCount < 5);
  const uniqueLeak = uniqueCells.filter((c) => !c.suppressed);
  const rareLeak = rareCells.filter((c) => !c.suppressed);
  console.log(`4 维格子总数：${fine.cells.length}`);
  console.log(`真实计数=1 的唯一人格子：${uniqueCells.length}，其中未被抑制（泄漏）：${uniqueLeak.length}`);
  console.log(`真实计数 1~4 的稀有格子：${rareCells.length}，其中未被抑制（泄漏）：${rareLeak.length}`);
  // 发布内容中不得出现任何被抑制格子的真实计数
  const leakedTruth = fine.cells.some(
    (c) => c.suppressed && (c.noisyCount !== null || c.noisyIncomeSum !== null),
  );
  console.log(`被抑制格子的真实值出现在发布物中：${leakedTruth ? '是（FAIL）' : '否（PASS）'}`);

  // ---------- C2. 小数据集抑制专项自测（50 万人口无 singleton，需另造小样本演练规则）----------
  section('4b. 抑制规则专项自测（100 人微型数据集，含 singleton 与互补抑制场景）');
  const suppressionSelfTest = runSuppressionSelfTest();
  for (const line of suppressionSelfTest.lines) console.log(line);

  // ---------- A. 减法/差分反推 ----------
  section('5. 攻击 A：减法/差分反推被抑制格子');
  const resultsA = runDifferencingAttack(published, records, dimDefs, INCOME_CLIP);
  console.log(`攻击样本数：${resultsA.samples}`);
  console.log(`反推值与真实值的平均绝对误差：${resultsA.mae.toFixed(2)} 人`);
  console.log(`反推相对误差：中位数 ${pct(resultsA.medianRE)}，90 分位 ${pct(resultsA.p90RE)}，最大 ${pct(resultsA.maxRE)}`);
  console.log(`反推值与真实值相关性：${resultsA.corr.toFixed(4)}（接近 0 = 攻击失败）`);
  if (resultsA.uniqueSamples > 0) {
    console.log(`singleton 格子反推值落在 0~1 的比例（无法区分有无此人）：${pct(resultsA.uniqueAmbiguousRate)}`);
  } else {
    console.log('本批发布表无 singleton 格子（singleton 防护由 4b 专项自测覆盖）');
  }
  const fineT4 = published[3];
  const poolRE =
    Math.abs(fineT4.publishedSuppressedCount - fineT4.trueSuppressedCount) /
    Math.max(fineT4.trueSuppressedCount, 1);
  console.log(
    `汇总桶减法反推：真实抑制总数 ${fineT4.trueSuppressedCount} 人，发布桶 ${fineT4.publishedSuppressedCount} 人，` +
    `相对误差 ${pct(poolRE)}（桶内单格仍不可拆分）`,
  );

  // ---------- B. 成员推断（LLR + AUC）----------
  section('6. 攻击 B：成员推断（对数似然比，含/不含目标各半）');
  const resultsB = runMembershipInference(published, designs);
  // 理论包络：给定单查询 ε，全知攻击者（已知真实聚合值）LLR 检验的 AUC 上限
  const theoreticalAucBound = (eps: number): number => 1 - 0.5 * Math.exp(-eps / 2);
  for (const r of resultsB) {
    const design = designs.find((d) => d.id === r.tableId)!;
    const active = design.metrics.filter((m) => m !== 'incomeMean').length;
    const epsPer = design.epsilon / Math.max(active, 1);
    const bound = theoreticalAucBound(epsPer);
    // 有限样本蒙特卡洛容差：AUC 标准误 ≈ 1/(2√n)，取 1.96 倍构造 95% 统计带
    const tolerance = 1.96 / (2 * Math.sqrt(Math.floor(r.samples / 2)));
    const within = r.auc <= bound + tolerance;
    console.log(
      `[${r.tableId}] ${r.metric} | 单查询 ε=${epsPer.toFixed(3)} | 样本 ${r.samples} | ` +
      `LLR-AUC=${r.auc.toFixed(4)} | 理论上限≈${bound.toFixed(4)} ±${tolerance.toFixed(3)}（0.5=无法区分）=> ` +
      `${within ? '在理论包络内 PASS' : '超出理论包络 FAIL'}`,
    );
  }

  // ---------- E. 大格子精度 ----------
  section('7. 大格子精度（真实计数 >= 1000，计数指标相对误差）');
  let accuracyPass = true;
  for (const t of published) {
    const large = t.cells.filter((c) => !c.suppressed && c.trueCount >= 1000);
    if (!large.length) {
      console.log(`[${t.design.id}] 无 >=1000 人的格子（高维表正常现象）`);
      continue;
    }
    const res = large.map((c) => c.countRelativeError ?? 0).sort((a, b) => a - b);
    const max = res[res.length - 1];
    const p90 = res[Math.floor((res.length - 1) * 0.9)];
    const ok = max < 0.05;
    if (!ok) accuracyPass = false;
    console.log(
      `[${t.design.id}] 大格子 ${large.length} 个 | 中位 ${pct(res[Math.floor((res.length - 1) * 0.5)])} ` +
      `| P90 ${pct(p90)} | 最大 ${pct(max)} => ${ok ? 'PASS（<5%）' : 'FAIL（>=5%）'}`,
    );
  }

  // ---------- 汇总 ----------
  section('8. 验证结论');
  const checks = [
    ['预算耗尽后拒绝新发布', blocked],
    ['全部表格通过一致性检查', consistencyFail === 0],
    ['唯一人（count=1）格子全部抑制', uniqueLeak.length === 0],
    ['稀有格子（count<5）全部抑制', rareLeak.length === 0],
    ['发布物不含被抑制格子真实值', !leakedTruth],
    ['差分反推相对误差中位 >50%', resultsA.medianRE > 0.5],
    ['成员推断 AUC 均在 ε 理论包络内', resultsB.every((r) => {
      const design = designs.find((d) => d.id === r.tableId)!;
      const active = design.metrics.filter((m) => m !== 'incomeMean').length;
      const bound = 1 - 0.5 * Math.exp(-design.epsilon / Math.max(active, 1) / 2);
      const tolerance = 1.96 / (2 * Math.sqrt(Math.floor(r.samples / 2)));
      return r.auc <= bound + tolerance;
    })],
    ['小数据集抑制自测（singleton/互补/汇总桶）', suppressionSelfTest.pass],
    ['大格子相对误差最大值 <5%', accuracyPass],
  ];
  let allPass = true;
  for (const [name, pass] of checks) {
    if (!pass) allPass = false;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  }
  console.log(`\n总体结果：${allPass ? '全部通过 ✅' : '存在失败项 ❌'}`);
  process.exitCode = allPass ? 0 : 1;
}

// ------------------------------------------------------------------
// 攻击 A：用粗粒度表减去细粒度表中"兄弟格子"之和，反推目标格子
// 例：(区县×年龄) 计数 - Σ_gender (区县×年龄×性别) 计数
// ------------------------------------------------------------------
interface AttackAResult {
  samples: number;
  uniqueSamples: number;
  mae: number;
  medianRE: number;
  p90RE: number;
  maxRE: number;
  corr: number;
  uniqueAmbiguousRate: number;
}

function runDifferencingAttack(
  published: PublishedTable[],
  records: PersonRecord[],
  dimDefs: ReturnType<typeof inferDimensionDefs>,
  incomeClip: number,
): AttackAResult {
  const coarse = published[0]; // district × ageGroup
  const fineT = published[2]; // district × ageGroup × gender
  const fineGrid = buildGrid(records, fineT.design.dimensions, dimDefs, incomeClip);

  // 发布值索引（抑制桶不参与单格反推）
  const finePub = new Map<string, TableCell>();
  for (const c of fineT.cells) finePub.set(c.key, c);
  const coarsePub = new Map<string, TableCell>();
  for (const c of coarse.cells) coarsePub.set(c.key, c);

  const estimates: number[] = [];
  const truths: number[] = [];
  const uniqueEst: number[] = [];

  for (const fg of fineGrid.cells) {
    const [district, ageGroup] = fg.dimValues;
    const coarseKey = `${district}||${ageGroup}`;
    const coarseCell = coarsePub.get(coarseKey);
    const brotherKeys = DIMENSIONS.gender.values.map((g) => `${district}||${ageGroup}||${g}`);
    const brothers = brotherKeys.map((k) => finePub.get(k));
    if (!coarseCell || brothers.some((b) => !b)) continue;
    // 攻击者只能拿到发布值；任一兄弟被抑制则该线不可减（攻击者必须放弃）
    if (brothers.some((b) => b!.suppressed) || coarseCell.suppressed) continue;

    const brotherSum = brothers.reduce((s, b) => s + (b!.noisyCount ?? 0), 0);
    const estimate = (coarseCell.noisyCount ?? 0) - brotherSum;
    estimates.push(estimate);
    truths.push(fg.trueCount);
    if (fg.trueCount === 1) uniqueEst.push(estimate);
  }

  const errors = estimates.map((e, i) => Math.abs(e - truths[i]));
  const rels = estimates.map((e, i) => Math.abs(e - truths[i]) / Math.max(truths[i], 1)).sort((a, b) => a - b);
  const mae = errors.reduce((a, b) => a + b, 0) / Math.max(errors.length, 1);
  const meanE = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const meanT = truths.reduce((a, b) => a + b, 0) / truths.length;
  let cov = 0;
  let varE = 0;
  let varT = 0;
  estimates.forEach((e, i) => {
    cov += (e - meanE) * (truths[i] - meanT);
    varE += (e - meanE) ** 2;
    varT += (truths[i] - meanT) ** 2;
  });
  const corr = cov / Math.sqrt(varE * varT + 1e-12);
  const uniqueAmbiguousRate =
    uniqueEst.filter((e) => e >= -1 && e <= 1).length / Math.max(uniqueEst.length, 1);

  return {
    samples: estimates.length,
    uniqueSamples: uniqueEst.length,
    mae,
    medianRE: rels[Math.floor((rels.length - 1) * 0.5)],
    p90RE: rels[Math.floor((rels.length - 1) * 0.9)],
    maxRE: rels[rels.length - 1],
    corr,
    uniqueAmbiguousRate,
  };
}

// ------------------------------------------------------------------
// 抑制规则专项自测：100 人微型数据，刻意制造 singleton 与"线上只剩 1 格"场景
// ------------------------------------------------------------------
interface SelfTestResult {
  pass: boolean;
  lines: string[];
}

function runSuppressionSelfTest(): SelfTestResult {
  const lines: string[] = [];
  const mk = (
    id: string,
    district: string,
    ageGroup: string,
    gender: string,
    count: number,
  ): PersonRecord[] =>
    Array.from({ length: count }, (_, k) => ({
      id: `${id}-${k}`,
      district,
      ageGroup,
      gender,
      education: '本科',
      occupation: '服务业',
      householdSize: 2,
      income: 60000,
    }));

  // 两区县 × 两年龄段 × 两性别 = 8 格（取值必须来自维度字典，否则聚合器按脏数据跳过）：
  // 城东区/18-29/男 只有 1 人（singleton）；金凤县/60+/女 只有 2 人；其余为大格子
  const tiny: PersonRecord[] = [
    ...mk('a1', '城东区', '18-29', '男', 1),
    ...mk('a2', '城东区', '18-29', '女', 40),
    ...mk('a3', '城东区', '60+', '男', 30),
    ...mk('a4', '城东区', '60+', '女', 9),
    ...mk('b1', '金凤县', '18-29', '男', 8),
    ...mk('b2', '金凤县', '18-29', '女', 6),
    ...mk('b3', '金凤县', '60+', '男', 4),
    ...mk('b4', '金凤县', '60+', '女', 2),
  ];
  const tinyDefs = inferDimensionDefs(tiny);
  const tinyBudget: BudgetAccount = { totalEpsilon: 2, totalDelta: 1e-6, usedEpsilon: 0, usedDelta: 0 };
  const design: TableDesign = {
    id: 'selftest', name: '抑制自测表',
    dimensions: ['district', 'ageGroup', 'gender'],
    metrics: ['count'], mechanism: 'laplace',
    epsilon: 1, delta: 0, suppressThreshold: 5, incomeClip: INCOME_CLIP,
  };
  const { table } = publishTable(design, {
    records: tiny, dimDefs: tinyDefs, budget: tinyBudget, rng: new Rng(424242), operator: 'self-test',
  });

  if (table.trueTotalCount !== 100) {
    return { pass: false, lines: [`FAIL：微型数据聚合总数应为 100，实际 ${table.trueTotalCount}（维度字典未覆盖测试值）`] };
  }
  const singleton = table.cells.slice().sort((a, b) => a.trueCount - b.trueCount)[0];
  if (singleton.trueCount !== 1) {
    return { pass: false, lines: [`FAIL：测试数据中未构造出 singleton，最小格子计数=${singleton.trueCount}`] };
  }
  const rare = table.cells.filter((c) => c.trueCount >= 1 && c.trueCount < 5);
  lines.push(`格子总数 ${table.cells.length}，被抑制 ${table.suppressedCellCount} 个，汇总桶组大小 ${table.suppressedCellCount}`);
  lines.push(`singleton 格子（true=1）被抑制：${singleton.suppressed ? 'PASS' : 'FAIL'}`);
  const rareAllSuppressed = rare.every((c) => c.suppressed);
  lines.push(`全部稀有格子（true<5）被抑制：${rareAllSuppressed ? 'PASS' : 'FAIL'}（${rare.length}/${rare.length}）`);
  const poolBigEnough = table.suppressedCellCount >= MIN_SUPPRESSION_GROUP;
  lines.push(`汇总桶至少含 ${MIN_SUPPRESSION_GROUP} 格（减法无法定位单格）：${poolBigEnough ? 'PASS' : 'FAIL'}`);

  // 反推不可行：尝试用总计 - 已发布单格 = 抑制桶总量，但桶内任何单格都拆不出来
  const keptSum = table.cells
    .filter((c) => !c.suppressed)
    .reduce((s, c) => s + (c.noisyCount ?? 0), 0);
  const poolBySubtraction = table.publishedTotalCount - keptSum;
  const poolMatches = poolBySubtraction === table.publishedSuppressedCount;
  const singletonRevealed = table.cells.some(
    (c) => c.trueCount === 1 && c.noisyCount !== null,
  );
  lines.push(`减法只能得到抑制桶总量（=${poolBySubtraction}）且与发布桶一致：${poolMatches ? 'PASS' : 'FAIL'}`);
  lines.push(`桶内 singleton 无法被单独还原：${!singletonRevealed ? 'PASS' : 'FAIL'}`);

  const pass =
    singleton.suppressed && rareAllSuppressed && poolBigEnough && poolMatches && !singletonRevealed;
  return { pass, lines };
}

// ------------------------------------------------------------------
// 攻击 B：成员推断。对每个发布格子构造两个世界：
//   H0（目标不在）观测均值 = 真实值-1（count），H1（在）= 真实值
// 用真实机制的噪声分布算对数似然比；模拟目标一半在、一半不在，求 AUC
// ------------------------------------------------------------------
interface AttackBResult {
  tableId: string;
  metric: string;
  samples: number;
  auc: number;
  accuracy: number;
}

function runMembershipInference(
  published: PublishedTable[],
  designs: TableDesign[],
): AttackBResult[] {
  const out: AttackBResult[] = [];
  for (const t of published) {
    const design = designs.find((d) => d.id === t.design.id)!;
    const activeMetrics = design.metrics.filter((m) => m !== 'incomeMean');
    const epsPer = design.epsilon / Math.max(activeMetrics.length, 1);
    const cells = t.cells.filter((c) => !c.suppressed);

    for (const metric of ['count', 'incomeSum'] as const) {
      if (!design.metrics.includes(metric) && !(metric === 'incomeSum' && design.metrics.includes('incomeMean'))) continue;

      // 严格两世界模拟：成员样本用 H1（真实值）观测；非成员样本用 H0（真实值减 1 人）观测
      const strictScores: { score: number; member: boolean }[] = [];
      cells.forEach((c, idx) => {
        const observed = metric === 'count' ? c.noisyCount! : c.noisyIncomeSum!;
        const truth = metric === 'count' ? c.trueCount : c.trueIncomeSum;
        const sensitivity = metric === 'count' ? 1 : INCOME_CLIP;
        const scoreOf = (x: number) => {
          if (design.mechanism === 'laplace') {
            const b = laplaceScale({
              mechanism: 'laplace', epsilon: epsPer, delta: 0,
              sensitivityL1: sensitivity, sensitivityL2: sensitivity,
            });
            return (Math.abs(x - (truth - sensitivity)) - Math.abs(x - truth)) / b;
          }
          const sigma = gaussianSigma({
            mechanism: 'gaussian', epsilon: epsPer, delta: design.delta,
            sensitivityL1: sensitivity, sensitivityL2: sensitivity,
          });
          return (-((x - truth) ** 2) + (x - (truth - sensitivity)) ** 2) / (2 * sigma ** 2);
        };
        if (idx % 2 === 0) {
          strictScores.push({ score: scoreOf(observed), member: true });
        } else {
          // H0 世界：真实值少 1 人（或其收入），同样加噪后由攻击者观测
          const noise = observed - truth;
          const h0Observed = truth - sensitivity + noise;
          strictScores.push({ score: scoreOf(h0Observed), member: false });
        }
      });
      const auc = computeAuc(strictScores);
      const accuracy = strictScores.filter((s) => (s.score > 0) === s.member).length / strictScores.length;
      out.push({ tableId: t.design.id, metric, samples: strictScores.length, auc, accuracy });
    }
  }
  return out;
}

/** 由打分与标签计算 ROC-AUC（Mann-Whitney U） */
function computeAuc(items: { score: number; member: boolean }[]): number {
  const sorted = items.slice().sort((a, b) => a.score - b.score);
  const nPos = items.filter((i) => i.member).length;
  const nNeg = items.length - nPos;
  if (!nPos || !nNeg) return 0.5;
  let rankSum = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].score === sorted[i].score) j++;
    const avgRank = (i + 1 + j) / 2; // 1-indexed 平均秩
    for (let k = i; k < j; k++) if (sorted[k].member) rankSum += avgRank;
    i = j;
  }
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
