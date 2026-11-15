// 差分隐私机制：拉普拉斯（(ε,0)-DP）与高斯（(ε,δ)-DP，analytic Gaussian 近似）
import type { Mechanism, BudgetAccount } from './types';
import type { Rng } from './rng';
export type { BudgetAccount };

export interface NoiseSpec {
  mechanism: Mechanism;
  epsilon: number; // 本次查询的 ε
  delta: number; // 高斯机制的 δ
  sensitivityL1: number; // L1 敏感度
  sensitivityL2: number; // L2 敏感度
}

/**
 * 高斯机制噪声标准差。
 * 采用经典校准（Dwork & Roth, 2014, Thm A.1）：
 *   σ >= sensitivityL2 * sqrt(2 ln(1.25/δ)) / ε
 * 对 ε∈(0,1) 给出严格 (ε,δ)-DP；界面会限制单次 ε < 1。
 */
export function gaussianSigma(spec: NoiseSpec): number {
  const { epsilon, delta, sensitivityL2 } = spec;
  if (epsilon >= 1) {
    throw new Error('高斯机制经典校准要求 ε < 1，请减小单表预算分配');
  }
  if (!(delta > 0 && delta < 1)) {
    throw new Error('高斯机制需要 0 < δ < 1');
  }
  return (sensitivityL2 * Math.sqrt(2 * Math.log(1.25 / delta))) / epsilon;
}

/** 拉普拉斯机制噪声尺度 b = L1敏感度 / ε */
export function laplaceScale(spec: NoiseSpec): number {
  if (!(spec.epsilon > 0)) throw new Error('ε 必须为正数');
  return spec.sensitivityL1 / spec.epsilon;
}

/** 按机制生成一份噪声 */
export function sampleNoise(spec: NoiseSpec, rng: Rng): number {
  if (spec.mechanism === 'laplace') {
    return rng.laplace() * laplaceScale(spec);
  }
  return rng.gaussian() * gaussianSigma(spec);
}

/** 预算核算：并行组合（同一数据集上不相交的维度组合格子，按最大 ε 计）取保守串行记账，
 *  这里对每张表按整表 ε 全额记账（composition 友好，且便于多表串行相加）。 */
export function remainingBudget(account: BudgetAccount): { epsilon: number; delta: number } {
  return {
    epsilon: account.totalEpsilon - account.usedEpsilon,
    delta: account.totalDelta - account.usedDelta,
  };
}

export function canConsume(account: BudgetAccount, epsilon: number, delta: number): boolean {
  const r = remainingBudget(account);
  return epsilon <= r.epsilon + 1e-12 && delta <= r.delta + 1e-12;
}

export function consume(account: BudgetAccount, epsilon: number, delta: number): void {
  if (!canConsume(account, epsilon, delta)) {
    throw new Error('总隐私预算不足，拒绝发布');
  }
  account.usedEpsilon += epsilon;
  account.usedDelta += delta;
}
