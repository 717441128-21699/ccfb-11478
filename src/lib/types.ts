// 核心类型定义：维度、指标、交叉表、发布结果

/** 个人级记录（原始微数据） */
export interface PersonRecord {
  id: string;
  district: string; // 区县
  ageGroup: string; // 年龄段
  gender: string; // 性别
  education: string; // 受教育程度
  occupation: string; // 行业
  householdSize: number; // 家庭规模（人）
  income: number; // 年收入（元）
}

export type DimensionKey =
  | 'district'
  | 'ageGroup'
  | 'gender'
  | 'education'
  | 'occupation';

export type MetricKey = 'count' | 'incomeSum' | 'incomeMean';

export interface DimensionDef {
  key: DimensionKey;
  label: string;
  values: string[];
}

export interface MetricDef {
  key: MetricKey;
  label: string;
  /** 该指标的敏感度（L2 敏感度，用于高斯；L1 敏感度用于拉普拉斯） */
  sensitivity: number;
  isInteger: boolean;
  isDerived?: boolean;
}

export type Mechanism = 'laplace' | 'gaussian';

/** 隐私预算账本（ε, δ 双预算，串行记账） */
export interface BudgetAccount {
  totalEpsilon: number;
  totalDelta: number;
  usedEpsilon: number;
  usedDelta: number;
}

/** 一张待发布交叉表的设计 */
export interface TableDesign {
  id: string;
  name: string;
  dimensions: DimensionKey[]; // 行维度组合（1~4 个）
  metrics: MetricKey[]; // 要发布的指标
  mechanism: Mechanism;
  epsilon: number; // 本表分配的 ε
  delta: number; // 高斯机制使用的 δ（拉普拉斯时为 0）
  /** 抑制阈值：真实计数 < threshold 的格子进入抑制流程 */
  suppressThreshold: number;
  /** 收入裁剪上界（元），下界为 0，用于限定敏感度 */
  incomeClip: number;
}

/** 单个格子（一个维度组合） */
export interface TableCell {
  key: string; // 维度值用 "||" 拼接
  dimValues: string[];
  trueCount: number;
  noisyCount: number | null; // 后处理后的发布计数（被抑制为 null）
  trueIncomeSum: number;
  noisyIncomeSum: number | null;
  incomeMean: number | null; // 派生指标
  suppressed: boolean;
  suppressReason?: 'threshold' | 'complementary' | 'empty';
  /** 该格子各指标的误差（发布值 - 真实值） */
  countError?: number;
  incomeSumError?: number;
  countRelativeError?: number;
  incomeSumRelativeError?: number;
}

export interface PublishedTable {
  design: TableDesign;
  createdAt: string;
  dimDefs: DimensionDef[];
  cells: TableCell[];
  /** 发布的总计（对未抑制格子 + 抑制汇总的后处理一致值） */
  publishedTotalCount: number;
  publishedTotalIncomeSum: number;
  publishedSuppressedCount: number;
  publishedSuppressedIncomeSum: number;
  trueSuppressedCount: number;
  trueSuppressedIncomeSum: number;
  trueTotalCount: number;
  trueTotalIncome: number;
  /** 预算消耗 */
  budgetCost: { epsilon: number; delta: number };
  /** 误差分布摘要 */
  errorSummary: ErrorSummary;
  suppressedCellCount: number;
}

export interface ErrorSummary {
  count: {
    cellCount: number; // 参与统计的未抑制格子数
    meanRelativeError: number;
    medianRelativeError: number;
    p90RelativeError: number;
    maxRelativeError: number;
    largeCellMaxRelativeError: number; // 真实计数 >= 1000 的格子最大相对误差
    largeCellCount: number;
  };
  incomeSum?: {
    cellCount: number;
    meanRelativeError: number;
    medianRelativeError: number;
    p90RelativeError: number;
    maxRelativeError: number;
    largeCellMaxRelativeError: number;
    largeCellCount: number;
  };
}

/** 审计记录 */
export interface AuditEntry {
  id: string;
  timestamp: string;
  operator: string;
  tableName: string;
  tableId: string;
  mechanism: Mechanism;
  dimensions: DimensionKey[];
  metrics: MetricKey[];
  epsilonUsed: number;
  deltaUsed: number;
  epsilonRemaining: number;
  deltaRemaining: number;
  cellCount: number;
  suppressedCellCount: number;
  dataRowCount: number;
  largeCellMaxRelativeError: number;
  note?: string;
}
