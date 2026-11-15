// 发布管线：把一张表设计 + 原始数据，变成一张可发布的加噪一致性交叉表
// 所有随机性来自注入的 Rng（可固定种子用于测试/攻击复现）
import { buildGrid, type Grid } from './aggregation';
import { planSuppression } from './suppression';
import {
  sampleNoise,
  canConsume,
  type BudgetAccount,
  type NoiseSpec,
} from './mechanisms';
import { nonNegativeIntegerConsistent, deriveMean } from './postprocess';
import {
  relativeError,
  summarizeCountErrors,
  summarizeIncomeErrors,
} from './errors';
import { METRICS } from './dimensions';
import type {
  AuditEntry,
  DimensionDef,
  DimensionKey,
  MetricKey,
  PersonRecord,
  PublishedTable,
  TableCell,
  TableDesign,
} from './types';
import type { Rng } from './rng';

/** 互补抑制最小组大小（k-匿名式下限，保证汇总桶不对应单一格子） */
export const MIN_SUPPRESSION_GROUP = 3;

export interface PublishContext {
  records: PersonRecord[];
  dimDefs: Record<DimensionKey, DimensionDef>;
  budget: BudgetAccount;
  rng: Rng;
  operator: string;
}

export class BudgetExhaustedError extends Error {}

/**
 * 预算分配：表级 ε 在实际加噪的基础指标（count/incomeSum）间均分；
 * incomeMean 是派生指标，不单独消耗预算。
 * 多指标通过串行组合（sequential composition）记账：总消耗 = 表级 ε。
 */
function splitBudget(design: TableDesign): number {
  const active = design.metrics.filter((m) => m !== 'incomeMean');
  return design.epsilon / Math.max(active.length, 1);
}

export function publishTable(design: TableDesign, ctx: PublishContext): {
  table: PublishedTable;
  audit: AuditEntry;
} {
  if (design.metrics.includes('incomeMean') && !design.metrics.includes('incomeSum')) {
    throw new Error('人均收入依赖收入总额，请同时勾选"收入总额"');
  }
  if (!canConsume(ctx.budget, design.epsilon, design.delta)) {
    throw new BudgetExhaustedError('总隐私预算不足：总预算已用完，拒绝发布新表');
  }

  // 1. 真实聚合网格
  const grid: Grid = buildGrid(ctx.records, design.dimensions, ctx.dimDefs, design.incomeClip);

  // 2. 抑制规划（基于真实计数，阈值规则本身不发布明细）
  const suppression = planSuppression(grid, design.suppressThreshold, MIN_SUPPRESSION_GROUP);
  const nCells = grid.cells.length;
  const keptIdx: number[] = [];
  const suppressedIdx: number[] = [];
  grid.cells.forEach((_, i) => {
    if (suppression.suppressed.has(i)) suppressedIdx.push(i);
    else keptIdx.push(i);
  });

  // 3. 分指标加噪（每个活跃指标独立一份噪声；预算均分）
  const perMetricEpsilon = splitBudget(design);
  const wantsCount = design.metrics.includes('count') || design.metrics.includes('incomeMean');
  const wantsIncome = design.metrics.includes('incomeSum') || design.metrics.includes('incomeMean');
  const metricActive: MetricKey[] = [];
  if (wantsCount) metricActive.push('count');
  if (wantsIncome) metricActive.push('incomeSum');

  const rawNoisyCount = new Array<number>(nCells).fill(0);
  const rawNoisyIncome = new Array<number>(nCells).fill(0);

  for (const metric of metricActive) {
    const def = METRICS[metric];
    const spec: NoiseSpec = {
      mechanism: design.mechanism,
      epsilon: perMetricEpsilon,
      delta: design.delta,
      sensitivityL1: def.sensitivity,
      sensitivityL2: def.sensitivity,
    };
    for (let i = 0; i < nCells; i++) {
      const z = sampleNoise(spec, ctx.rng);
      if (metric === 'count') rawNoisyCount[i] = grid.cells[i].trueCount + z;
      else rawNoisyIncome[i] = grid.cells[i].trueIncomeSum + z;
    }
  }

  // 4. 汇总桶：被抑制格子的加噪值先求和，再做一致性处理（不暴露任何单格）
  const poolRawCount = suppressedIdx.reduce((s, i) => s + rawNoisyCount[i], 0);
  const poolRawIncome = suppressedIdx.reduce((s, i) => s + rawNoisyIncome[i], 0);

  // 5. 后处理：非负 + 最大余数整数化。常规格子与汇总桶分别处理后，合计天然守恒
  const keptRawCount = keptIdx.map((i) => rawNoisyCount[i]);
  const keptPublishedCount = nonNegativeIntegerConsistent(keptRawCount);
  const poolPublishedCount = nonNegativeIntegerConsistent([poolRawCount])[0];

  const keptRawIncome = keptIdx.map((i) => rawNoisyIncome[i]);
  const keptPublishedIncome = nonNegativeIntegerConsistent(keptRawIncome);
  const poolPublishedIncome = nonNegativeIntegerConsistent([poolRawIncome])[0];

  // 6. 组装发布格子
  const cells: TableCell[] = grid.cells.map((gc, i) => {
    const isSuppressed = suppression.suppressed.has(i);
    const base: TableCell = {
      key: gc.key,
      dimValues: gc.dimValues,
      trueCount: gc.trueCount,
      noisyCount: 0,
      trueIncomeSum: gc.trueIncomeSum,
      noisyIncomeSum: 0,
      incomeMean: null,
      suppressed: isSuppressed,
      suppressReason: suppression.reasons.get(i),
    };
    if (isSuppressed) {
      base.noisyCount = null;
      base.noisyIncomeSum = null;
      return base;
    }
    const keptPos = keptIdx.indexOf(i);
    const pubCount = keptPublishedCount[keptPos];
    const pubIncome = keptPublishedIncome[keptPos];
    base.noisyCount = pubCount;
    base.noisyIncomeSum = pubIncome;
    base.incomeMean = deriveMean(pubIncome, pubCount);
    base.countError = pubCount - gc.trueCount;
    base.incomeSumError = pubIncome - gc.trueIncomeSum;
    base.countRelativeError = relativeError(pubCount, gc.trueCount);
    base.incomeSumRelativeError = relativeError(pubIncome, gc.trueIncomeSum);
    return base;
  });

  // 抑制汇总桶作为一个特殊"格子"附加在末尾（key 固定，UI 单独渲染）
  const trueSuppressedCount = suppressedIdx.reduce((s, i) => s + grid.cells[i].trueCount, 0);
  const trueSuppressedIncome = suppressedIdx.reduce(
    (s, i) => s + grid.cells[i].trueIncomeSum,
    0,
  );

  const publishedTotalCount =
    keptPublishedCount.reduce((a, b) => a + b, 0) + poolPublishedCount;
  const publishedTotalIncome =
    keptPublishedIncome.reduce((a, b) => a + b, 0) + poolPublishedIncome;

  const errorSummary = {
    count: summarizeCountErrors(cells),
    incomeSum: wantsIncome ? summarizeIncomeErrors(cells) : undefined,
  };

  const table: PublishedTable = {
    design,
    createdAt: new Date().toISOString(),
    dimDefs: design.dimensions.map((d) => ctx.dimDefs[d]),
    cells,
    publishedTotalCount,
    publishedTotalIncomeSum: publishedTotalIncome,
    publishedSuppressedCount: poolPublishedCount,
    publishedSuppressedIncomeSum: poolPublishedIncome,
    trueSuppressedCount,
    trueSuppressedIncomeSum: trueSuppressedIncome,
    trueTotalCount: grid.trueTotalCount,
    trueTotalIncome: grid.trueTotalIncome,
    budgetCost: { epsilon: design.epsilon, delta: design.delta },
    errorSummary,
    suppressedCellCount: suppressedIdx.length,
  };

  // 7. 预算记账（发布成功才扣减）
  const epsilonBefore = ctx.budget.usedEpsilon;
  const deltaBefore = ctx.budget.usedDelta;
  ctx.budget.usedEpsilon += design.epsilon;
  ctx.budget.usedDelta += design.delta;

  const audit: AuditEntry = {
    id: `audit-${Date.now()}-${Math.floor(ctx.rng.next() * 1e6)}`,
    timestamp: new Date().toISOString(),
    operator: ctx.operator,
    tableName: design.name,
    tableId: design.id,
    mechanism: design.mechanism,
    dimensions: design.dimensions,
    metrics: design.metrics,
    epsilonUsed: design.epsilon,
    deltaUsed: design.delta,
    epsilonRemaining: ctx.budget.totalEpsilon - ctx.budget.usedEpsilon,
    deltaRemaining: ctx.budget.totalDelta - ctx.budget.usedDelta,
    cellCount: cells.length,
    suppressedCellCount: suppressedIdx.length,
    dataRowCount: ctx.records.length,
    largeCellMaxRelativeError: errorSummary.count.largeCellMaxRelativeError,
    note: `发布前累计 ε=${epsilonBefore.toFixed(4)}, δ=${deltaBefore.toExponential(2)}`,
  };

  return { table, audit };
}
