// 一致性后处理：
// - 非负化：所有发布值裁剪到 >= 0（DP 的后处理，不消耗额外预算）
// - 整数化：最大余数法（Hamilton 分摊），floor 后按小数部分大小分配余数，总和严格守恒
// - 合计守恒：合计永远由格子值求和得到，绝不独立加噪，因此"子项加总 = 合计"恒成立
// - 人均收入：由后处理后的收入总额 / 后处理后的计数派生，不独立加噪

export interface PostProcessedValue {
  raw: number; // 加噪后、后处理前
  published: number; // 非负整数
}

/** 对一组加噪值做非负 + 整数一致性处理，返回整数数组，其和等于各值裁剪后之和的取整 */
export function nonNegativeIntegerConsistent(rawValues: number[]): number[] {
  const clipped = rawValues.map((v) => Math.max(v, 0));
  const floors = clipped.map((v) => Math.floor(v));
  const fractions = clipped.map((v) => v - Math.floor(v));
  const targetSum = Math.round(clipped.reduce((a, b) => a + b, 0));
  let residual = targetSum - floors.reduce((a, b) => a + b, 0);

  const order = fractions
    .map((f, i) => ({ f, i }))
    // 余数优先分给小数部分最大的格子；并列时按下标，保证确定性
    .sort((a, b) => b.f - a.f || a.i - b.i);

  const out = floors.slice();
  let p = 0;
  while (residual > 0 && p < order.length) {
    out[order[p].i] += 1;
    residual--;
    p++;
  }
  // residual 理论上 >= 0 且 <= 格子数；若所有分数都为 0 仍有余量（targetSum 上取整导致），
  // 从头补给非抑制的常规格子
  let q = 0;
  while (residual > 0 && q < out.length) {
    out[q] += 1;
    residual--;
    q++;
  }
  return out;
}

/** 浮点指标（仅做非负处理，不强制取整，用于需要保留小数的派生展示） */
export function nonNegative(raw: number): number {
  return Math.max(raw, 0);
}

/**
 * 派生人均收入：publishedIncomeSum / publishedCount。
 * 计数为 0 时返回 null（界面显示 "—"）。
 */
export function deriveMean(incomeSum: number | null, count: number | null): number | null {
  if (incomeSum === null || count === null || count <= 0) return null;
  return incomeSum / count;
}
