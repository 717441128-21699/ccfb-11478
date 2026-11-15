// 差分隐私机制与预算核算
//
// 隐私单元:个人(一行记录)。假设每人一行。
// - 计数查询:增删一人只改变一个格子的计数,L1 敏感度 Δ = 1。
// - 截断求和:每人贡献裁剪到 [0, B],Δ = B。
// - 均值:不直接发布,由加噪的"和"与"计数"相除得到,二者各自计费。
//
// 拉普拉斯机制:每查询 ε-DP,噪声尺度 b = Δ/ε。
// 高斯机制:每查询 (ε, δ)-DP,σ = Δ·sqrt(2·ln(1.25/δ))/ε。
// 组合:采用基本组合(basic composition),总 ε、δ 为各次发布之和,
// 简单保守,便于向非技术审计方解释。

export function laplaceScale(sensitivity: number, epsilon: number): number {
  return sensitivity / epsilon;
}

export function gaussianSigma(
  sensitivity: number,
  epsilon: number,
  delta: number
): number {
  return (sensitivity * Math.sqrt(2 * Math.log(1.25 / delta))) / epsilon;
}

/** 一次发布里,各指标查询的预算均分:返回每个"原子查询"分到的 ε */
export interface AtomicQuery {
  label: string; // 'count' | `sum:${field}`
  sensitivity: number;
  epsilon: number;
  delta: number;
}

export function planAtomicQueries(spec: {
  metrics: { kind: string; field?: string; clipBound?: number }[];
  epsilon: number;
  delta: number;
}): AtomicQuery[] {
  const queries: { label: string; sensitivity: number }[] = [];
  const needCount = spec.metrics.some((m) => m.kind === 'count' || m.kind === 'mean');
  if (needCount) queries.push({ label: 'count', sensitivity: 1 });
  const sumFields = new Set<string>();
  for (const m of spec.metrics) {
    if ((m.kind === 'sum' || m.kind === 'mean') && m.field && !sumFields.has(m.field)) {
      sumFields.add(m.field);
      queries.push({ label: `sum:${m.field}`, sensitivity: m.clipBound ?? 0 });
    }
  }
  const n = queries.length;
  return queries.map((q) => ({
    ...q,
    epsilon: spec.epsilon / n,
    delta: spec.delta / n,
  }));
}

/** 预算账户:总量控制 + 已消耗记账 */
export class BudgetAccountant {
  private spentEpsilon = 0;
  private spentDelta = 0;

  constructor(
    public totalEpsilon: number,
    public totalDelta: number
  ) {}

  get spent() {
    return { epsilon: this.spentEpsilon, delta: this.spentDelta };
  }
  get remaining() {
    return {
      epsilon: this.totalEpsilon - this.spentEpsilon,
      delta: this.totalDelta - this.spentDelta,
    };
  }

  canSpend(epsilon: number, delta: number): boolean {
    return (
      epsilon > 0 &&
      delta >= 0 &&
      this.spentEpsilon + epsilon <= this.totalEpsilon + 1e-12 &&
      this.spentDelta + delta <= this.totalDelta + 1e-15
    );
  }

  /** 扣减预算;不足则抛错,调用方应先用 canSpend 检查 */
  spend(epsilon: number, delta: number): void {
    if (!this.canSpend(epsilon, delta)) {
      throw new Error(
        `隐私预算不足:需 ε=${epsilon.toFixed(4)} δ=${delta},` +
          `剩余 ε=${this.remaining.epsilon.toFixed(4)} δ=${this.remaining.delta}`
      );
    }
    this.spentEpsilon += epsilon;
    this.spentDelta += delta;
  }

  /** 从审计日志恢复累计消耗(页面刷新后保持一致) */
  restore(spentEpsilon: number, spentDelta: number): void {
    this.spentEpsilon = spentEpsilon;
    this.spentDelta = spentDelta;
  }
}
