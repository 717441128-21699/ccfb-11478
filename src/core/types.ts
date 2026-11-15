// 核心类型定义

export type Row = Record<string, string | number>;

export type MetricKind = 'count' | 'sum' | 'mean';

export interface MetricSpec {
  kind: MetricKind;
  /** sum/mean 对应的数值字段名 */
  field?: string;
  /** sum/mean 的截断上界(贡献裁剪,决定敏感度) */
  clipBound?: number;
}

export type Mechanism = 'laplace' | 'gaussian';

export interface TableSpec {
  id: string;
  name: string;
  /** 交叉维度(分类字段),1~3 个 */
  dimensions: string[];
  metrics: MetricSpec[];
  mechanism: Mechanism;
  /** 本表消耗的隐私预算 ε */
  epsilon: number;
  /** 本表消耗的 δ(仅高斯机制) */
  delta: number;
  /** 小格子抑制阈值(基于加噪计数) */
  suppressionThreshold: number;
}

/** 交叉表的一个格子(未加噪) */
export interface Cell {
  values: string[]; // 各维度取值,顺序同 dimensions
  count: number;
  sums: Record<string, number>; // field -> 截断后的和
}

export interface MetricResult {
  kind: MetricKind;
  field?: string;
  value: number;
}

export interface ReleasedCell {
  values: string[];
  metrics: MetricResult[];
  /** 取整后的加噪计数/求和(派生边际合计与均值用) */
  roundedCount: number;
  roundedSums: Record<string, number>;
  /** 用于抑制判断的加噪计数(未取整) */
  noisyCount: number;
  suppressed: boolean;
  /** 抑制类型:primary=小格子, complementary=配合抑制 */
  suppressReason?: 'primary' | 'complementary';
}

export interface MarginEntry {
  /** 沿哪些维度汇总(空数组 = 总计) */
  dims: string[];
  values: string[];
  metrics: MetricResult[];
  cellCount: number; // 参与汇总的已发布格子数
}

export interface ReleasedTable {
  spec: TableSpec;
  dimensionDomains: string[][];
  cells: ReleasedCell[];
  /** 边际合计(仅基于已发布格子求和,保证加总一致) */
  margins: MarginEntry[];
  stats: {
    totalCells: number;
    suppressedPrimary: number;
    suppressedComplementary: number;
    publishedCells: number;
  };
}

export interface AuditEntry {
  seq: number;
  timestamp: string; // ISO
  operator: string;
  tableName: string;
  dimensions: string[];
  metrics: string[]; // 人类可读
  mechanism: Mechanism;
  epsilon: number;
  delta: number;
  suppressionThreshold: number;
  totalCells: number;
  suppressedCells: number;
  cumulativeEpsilon: number; // 本次发布后累计
  cumulativeDelta: number;
}
