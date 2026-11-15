// 发布前误差评估:按格子大小给出相对误差的解析分布
//
// 拉普拉斯噪声:|误差| 的中位数 = b·ln2,95 分位 = b·ln(20),标准差 = b·√2。
// 高斯噪声:标准差 = σ,95% 区间半宽 ≈ 1.96σ。
// 相对误差 ≈ 噪声 / 格子真实大小,因此按格子大小分桶展示。

import type { Mechanism } from './types.js';

export interface ErrorBucket {
  label: string;
  minSize: number; // 含
  maxSize: number; // 不含,Infinity 表示无上界
  cellCount: number; // 该桶内格子数(按真实大小)
  typicalRelErr: number; // 典型相对误差(中位数绝对误差 / 桶代表大小)
  p95RelErr: number; // 95 分位相对误差
}

const BUCKETS: [string, number, number][] = [
  ['< 10', 0, 10],
  ['10 – 49', 10, 50],
  ['50 – 99', 50, 100],
  ['100 – 499', 100, 500],
  ['500 – 999', 500, 1000],
  ['1 000 – 4 999', 1000, 5000],
  ['≥ 5 000', 5000, Infinity],
];

export function noiseStd(mechanism: Mechanism, scaleOrSigma: number): number {
  return mechanism === 'laplace' ? scaleOrSigma * Math.SQRT2 : scaleOrSigma;
}

export function noiseMedianAbs(mechanism: Mechanism, scaleOrSigma: number): number {
  return mechanism === 'laplace' ? scaleOrSigma * Math.LN2 : scaleOrSigma * 0.6745;
}

export function noiseP95Abs(mechanism: Mechanism, scaleOrSigma: number): number {
  return mechanism === 'laplace'
    ? scaleOrSigma * Math.log(20)
    : scaleOrSigma * 1.96;
}

/** 桶代表大小:几何平均(上界无穷时用下界 ×3 近似) */
function reprSize(min: number, max: number): number {
  const hi = max === Infinity ? min * 3 : max;
  return Math.sqrt(Math.max(min, 1e-9) * hi);
}

export function errorBuckets(
  mechanism: Mechanism,
  scaleOrSigma: number,
  cellSizes: number[]
): ErrorBucket[] {
  const med = noiseMedianAbs(mechanism, scaleOrSigma);
  const p95 = noiseP95Abs(mechanism, scaleOrSigma);
  return BUCKETS.map(([label, minSize, maxSize]) => {
    const cellCount = cellSizes.filter((s) => s >= minSize && s < maxSize).length;
    const repr = reprSize(minSize, maxSize);
    return {
      label,
      minSize,
      maxSize,
      cellCount,
      typicalRelErr: med / repr,
      p95RelErr: p95 / repr,
    };
  }).filter((b) => b.cellCount > 0);
}
