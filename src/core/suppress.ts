// 小格子抑制:主抑制 + 配合抑制(complementary suppression)
//
// 风险:若某行/列只抑制一个格子,攻击者用"边际合计 − 已发布格子"
// 即可反解出被抑制的值。对策:保证每一行、每一列被抑制的格子数
// 为 0 或 ≥2,使线性方程组欠定,无法唯一反解。
// 此外发布的边际合计只由已发布格子求和,进一步切断反推路径。

export interface SuppressibleCell {
  values: string[];
  noisyCount: number;
  suppressed: boolean;
  suppressReason?: 'primary' | 'complementary';
}

export function applySuppression(
  cells: SuppressibleCell[],
  nDims: number,
  threshold: number
): { primary: number; complementary: number } {
  // 1. 主抑制
  let primary = 0;
  for (const c of cells) {
    if (c.noisyCount < threshold) {
      c.suppressed = true;
      c.suppressReason = 'primary';
      primary++;
    }
  }

  // 2. 配合抑制:把表格看成 (前 n-1 维) × (最后 1 维) 的二维表,
  //    反复修补"恰好只抑制 1 格"的行与列。
  let complementary = 0;
  const keyOf = (vals: string[]) => vals.join('');

  const rowGroups = new Map<string, SuppressibleCell[]>();
  const colGroups = new Map<string, SuppressibleCell[]>();
  for (const c of cells) {
    const rowKey = nDims > 1 ? keyOf(c.values.slice(0, nDims - 1)) : '(all)';
    const colKey = nDims > 1 ? c.values[nDims - 1] : '(all)';
    if (!rowGroups.has(rowKey)) rowGroups.set(rowKey, []);
    if (!colGroups.has(colKey)) colGroups.set(colKey, []);
    rowGroups.get(rowKey)!.push(c);
    colGroups.get(colKey)!.push(c);
  }

  const fixGroup = (group: SuppressibleCell[]): boolean => {
    const sup = group.filter((c) => c.suppressed);
    if (sup.length !== 1) return false;
    // 抑制该组中加噪计数最小的未抑制格子
    const candidates = group
      .filter((c) => !c.suppressed)
      .sort((a, b) => a.noisyCount - b.noisyCount);
    if (candidates.length === 0) return false;
    candidates[0].suppressed = true;
    candidates[0].suppressReason = 'complementary';
    complementary++;
    return true;
  };

  // 修补一个格子可能让另一组变成"恰好 1 格",迭代至不动点
  const maxIter = cells.length + 10;
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (const g of rowGroups.values()) changed = fixGroup(g) || changed;
    for (const g of colGroups.values()) changed = fixGroup(g) || changed;
    if (!changed) break;
  }

  return { primary, complementary };
}

/**
 * 发布前自检:确认不存在"某行/列恰好抑制 1 格"的情况。
 * 验证脚本用它证明减法攻击无法唯一反解。
 */
export function checkComplementarySuppression(
  cells: SuppressibleCell[],
  nDims: number
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const keyOf = (vals: string[]) => vals.join('');
  const groups = new Map<string, number>();
  for (const c of cells) {
    if (!c.suppressed) continue;
    const rowKey = 'R:' + (nDims > 1 ? keyOf(c.values.slice(0, nDims - 1)) : '(all)');
    const colKey = 'C:' + (nDims > 1 ? c.values[nDims - 1] : '(all)');
    groups.set(rowKey, (groups.get(rowKey) ?? 0) + 1);
    groups.set(colKey, (groups.get(colKey) ?? 0) + 1);
  }
  for (const [k, cnt] of groups) {
    if (cnt === 1) violations.push(`${k} 只抑制了 1 格,可被减法反解`);
  }
  return { ok: violations.length === 0, violations };
}
