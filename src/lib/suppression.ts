// 抑制规则：
// 1) 主抑制：真实计数 < 阈值的非空格子
// 2) 空格子（真实计数为 0）同样进入抑制集，不单独发布
// 3) 全局互补抑制（防减法反推）：全部被抑制格子汇总为一个噪声"抑制项桶"发布，
//    桶内格子数必须 >= k，否则按真实计数最小原则追加抑制——
//    攻击者最多减出桶的噪声总量，无法拆出任何单个格子（含 singleton）
import type { Grid } from './aggregation';

export interface SuppressionResult {
  suppressed: Set<number>; // 被抑制格子下标
  reasons: Map<number, 'threshold' | 'complementary' | 'empty'>;
  pooledGroupSize: number; // 抑制汇总桶包含的格子数
}

export function planSuppression(
  grid: Grid,
  threshold: number,
  minGroupSize: number,
): SuppressionResult {
  const n = grid.cells.length;
  const suppressed = new Set<number>();
  const reasons = new Map<number, 'threshold' | 'complementary' | 'empty'>();

  // 1) 主抑制 + 空单元格
  grid.cells.forEach((c, i) => {
    if (c.trueCount === 0) {
      suppressed.add(i);
      reasons.set(i, 'empty');
    } else if (c.trueCount < threshold) {
      suppressed.add(i);
      reasons.set(i, 'threshold');
    }
  });

  // 2) 全局抑制集合 >= k：保证汇总桶不对应任何单个格子，减法无法定位 singleton
  const markComplementary = (i: number) => {
    if (!suppressed.has(i)) {
      suppressed.add(i);
      reasons.set(i, 'complementary');
    }
  };

  let guard = 0;
  while (suppressed.size < minGroupSize && suppressed.size < n && guard < n + 1) {
    let best = -1;
    let bestCount = Infinity;
    grid.cells.forEach((c, i) => {
      if (!suppressed.has(i) && c.trueCount < bestCount) {
        bestCount = c.trueCount;
        best = i;
      }
    });
    if (best >= 0) markComplementary(best);
    guard++;
  }

  return { suppressed, reasons, pooledGroupSize: suppressed.size };
}
