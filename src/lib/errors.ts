// 误差统计：按格子真实规模分层给出相对误差分布
import type { TableCell } from './types';

export interface PercentileStats {
  cellCount: number;
  meanRelativeError: number;
  medianRelativeError: number;
  p90RelativeError: number;
  maxRelativeError: number;
  largeCellMaxRelativeError: number; // 真实计数 >= 1000
  largeCellCount: number;
}

export const LARGE_CELL_THRESHOLD = 1000;

function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] * (hi - pos) + sortedAsc[hi] * (pos - lo);
}

function summarize(values: number[]): PercentileStats {
  const safe = values.filter((v) => Number.isFinite(v));
  if (safe.length === 0) {
    return {
      cellCount: 0,
      meanRelativeError: 0,
      medianRelativeError: 0,
      p90RelativeError: 0,
      maxRelativeError: 0,
      largeCellMaxRelativeError: 0,
      largeCellCount: 0,
    };
  }
  const sorted = safe.slice().sort((a, b) => a - b);
  return {
    cellCount: safe.length,
    meanRelativeError: safe.reduce((a, b) => a + b, 0) / safe.length,
    medianRelativeError: percentile(sorted, 0.5),
    p90RelativeError: percentile(sorted, 0.9),
    maxRelativeError: sorted[sorted.length - 1],
    largeCellMaxRelativeError: 0,
    largeCellCount: 0,
  };
}

/** 相对误差 = |发布值 - 真实值| / max(真实值, 1)，以百分数表示 */
export function relativeError(published: number, truth: number): number {
  return Math.abs(published - truth) / Math.max(truth, 1);
}

export function summarizeCountErrors(cells: TableCell[]): PercentileStats {
  const published = cells.filter((c) => !c.suppressed && c.noisyCount !== null);
  const stats = summarize(published.map((c) => c.countRelativeError ?? 0));
  const large = published.filter((c) => c.trueCount >= LARGE_CELL_THRESHOLD);
  stats.largeCellCount = large.length;
  stats.largeCellMaxRelativeError = large.length
    ? Math.max(...large.map((c) => c.countRelativeError ?? 0))
    : 0;
  return stats;
}

export function summarizeIncomeErrors(cells: TableCell[]): PercentileStats | undefined {
  const published = cells.filter(
    (c) => !c.suppressed && c.noisyIncomeSum !== null && c.trueIncomeSum > 0,
  );
  if (published.length === 0) return undefined;
  const stats = summarize(published.map((c) => c.incomeSumRelativeError ?? 0));
  const large = published.filter((c) => c.trueCount >= LARGE_CELL_THRESHOLD);
  stats.largeCellCount = large.length;
  stats.largeCellMaxRelativeError = large.length
    ? Math.max(...large.map((c) => c.incomeSumRelativeError ?? 0))
    : 0;
  return stats;
}
