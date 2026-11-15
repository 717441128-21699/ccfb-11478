// 发布流水线:交叉表 → 加噪 → 一致性后处理 → 抑制 → 派生边际合计
import { buildCrossTab } from './crosstab.js';
import {
  gaussianSigma,
  laplaceScale,
  planAtomicQueries,
} from './mechanisms.js';
import { clampNonNegative, largestRemainderRound } from './postprocess.js';
import { Sampler } from './rng.js';
import { applySuppression } from './suppress.js';
import type {
  MarginEntry,
  MetricResult,
  ReleasedCell,
  ReleasedTable,
  Row,
  TableSpec,
} from './types.js';

export function releaseTable(rows: Row[], spec: TableSpec, sampler: Sampler): ReleasedTable {
  if (spec.dimensions.length < 1 || spec.dimensions.length > 3) {
    throw new Error('交叉维度数量须为 1~3');
  }
  if (spec.metrics.length === 0) throw new Error('至少选择一个指标');
  if (spec.epsilon <= 0) throw new Error('ε 必须为正');

  const tab = buildCrossTab(rows, spec.dimensions, spec.metrics);
  const queries = planAtomicQueries(spec);
  const qCount = queries.find((q) => q.label === 'count');

  // 每个原子查询的噪声参数
  const noiseOf = (label: string): number => {
    const q = queries.find((x) => x.label === label)!;
    return spec.mechanism === 'laplace'
      ? laplaceScale(q.sensitivity, q.epsilon)
      : gaussianSigma(q.sensitivity, q.epsilon, q.delta);
  };
  const draw = (param: number) =>
    spec.mechanism === 'laplace' ? sampler.laplace(param) : sampler.gaussian(param);

  // 1. 加噪
  const noisyCounts = tab.cells.map((c) => (qCount ? c.count + draw(noiseOf('count')) : c.count));
  const noisySums: Record<string, number[]> = {};
  for (const f of tab.sumFields) {
    const p = noiseOf(`sum:${f}`);
    noisySums[f] = tab.cells.map((c) => c.sums[f] + draw(p));
  }

  // 2. 一致性后处理:非负 → 保总取整
  const roundCounts = qCount
    ? largestRemainderRound(clampNonNegative(noisyCounts))
    : tab.cells.map((c) => c.count);
  const roundSums: Record<string, number[]> = {};
  for (const f of tab.sumFields) {
    roundSums[f] = largestRemainderRound(clampNonNegative(noisySums[f]));
  }

  // 3. 组装格子指标
  const cells: ReleasedCell[] = tab.cells.map((c, i) => {
    const metrics: MetricResult[] = spec.metrics.map((m) => {
      if (m.kind === 'count') return { kind: m.kind, value: roundCounts[i] };
      if (m.kind === 'sum') return { kind: m.kind, field: m.field, value: roundSums[m.field!][i] };
      // mean:由取整后的和 / 计数派生,保证表内一致
      const cnt = roundCounts[i];
      const value = cnt > 0 ? roundSums[m.field!][i] / cnt : 0;
      return { kind: m.kind, field: m.field, value: Math.round(value * 100) / 100 };
    });
    return {
      values: c.values,
      metrics,
      roundedCount: roundCounts[i],
      roundedSums: Object.fromEntries(tab.sumFields.map((f) => [f, roundSums[f][i]])),
      noisyCount: noisyCounts[i],
      suppressed: false,
    };
  });

  // 4. 小格子抑制(主抑制 + 配合抑制)
  const sup = applySuppression(cells, spec.dimensions.length, spec.suppressionThreshold);
  // 计数为 0 的格子上的均值无意义,一并按主抑制处理
  for (const c of cells) {
    const cnt = c.metrics.find((m) => m.kind === 'count');
    if (!c.suppressed && cnt && cnt.value === 0 && c.metrics.some((m) => m.kind === 'mean')) {
      c.suppressed = true;
      c.suppressReason = 'primary';
      sup.primary++;
    }
  }

  // 5. 边际合计:仅由已发布格子求和(加总一致,且切断减法反推路径)
  const published = cells.filter((c) => !c.suppressed);
  const margins = buildMargins(published, spec);

  return {
    spec,
    dimensionDomains: tab.domains,
    cells,
    margins,
    stats: {
      totalCells: cells.length,
      suppressedPrimary: sup.primary,
      suppressedComplementary: sup.complementary,
      publishedCells: published.length,
    },
  };
}

/** 全部真子集边际 + 总计 */
function buildMargins(published: ReleasedCell[], spec: TableSpec): MarginEntry[] {
  const k = spec.dimensions.length;
  const subsets: number[][] = [[]];
  for (let mask = 1; mask < (1 << k) - 1; mask++) {
    const sub: number[] = [];
    for (let i = 0; i < k; i++) if (mask & (1 << i)) sub.push(i);
    subsets.push(sub);
  }
  const out: MarginEntry[] = [];
  for (const sub of subsets) {
    const groups = new Map<string, ReleasedCell[]>();
    for (const c of published) {
      const key = sub.map((i) => c.values[i]).join('');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    for (const [, groupCells] of [...groups.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : 1
    )) {
      const metrics: MetricResult[] = spec.metrics.map((m, mi) => {
        if (m.kind === 'mean') {
          const sum = groupCells.reduce((a, c) => a + (c.roundedSums[m.field!] ?? 0), 0);
          const cnt = groupCells.reduce((a, c) => a + c.roundedCount, 0);
          return { kind: m.kind, field: m.field, value: cnt > 0 ? Math.round((sum / cnt) * 100) / 100 : 0 };
        }
        const value = groupCells.reduce((a, c) => a + c.metrics[mi].value, 0);
        return { kind: m.kind, field: m.field, value };
      });
      out.push({
        dims: sub.map((i) => spec.dimensions[i]),
        values: groupCells[0].values.filter((_, i) => sub.includes(i)),
        metrics,
        cellCount: groupCells.length,
      });
    }
  }
  return out;
}
