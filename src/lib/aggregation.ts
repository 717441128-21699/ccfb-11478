// 交叉表聚合：在完整维度网格上统计真实计数与裁剪后收入总额
import type { DimensionDef, DimensionKey, PersonRecord } from './types';

export interface GridCell {
  key: string;
  dimValues: string[];
  trueCount: number;
  trueIncomeSum: number; // 裁剪到 [0, incomeClip] 后的收入和
}

export interface Grid {
  dimensions: DimensionKey[];
  dimDefs: DimensionDef[];
  cells: GridCell[];
  /** key -> 下标 */
  index: Map<string, number>;
  trueTotalCount: number;
  trueTotalIncome: number;
}

function cartesian(valuesLists: string[][]): string[][] {
  let out: string[][] = [[]];
  for (const values of valuesLists) {
    const next: string[][] = [];
    for (const prefix of out) {
      for (const v of values) next.push([...prefix, v]);
    }
    out = next;
  }
  return out;
}

export function buildGrid(
  records: PersonRecord[],
  dimensions: DimensionKey[],
  dimDefs: Record<DimensionKey, DimensionDef>,
  incomeClip: number,
): Grid {
  const defs = dimensions.map((d) => dimDefs[d]);
  const combos = cartesian(defs.map((d) => d.values));
  const cells: GridCell[] = combos.map((dimValues) => ({
    key: dimValues.join('||'),
    dimValues,
    trueCount: 0,
    trueIncomeSum: 0,
  }));
  const index = new Map<string, number>();
  cells.forEach((c, i) => index.set(c.key, i));

  let trueTotalCount = 0;
  let trueTotalIncome = 0;
  for (const r of records) {
    const vals = dimensions.map((d) => r[d] as string);
    const idx = index.get(vals.join('||'));
    if (idx === undefined) continue; // 维度值不在字典内（脏数据），跳过
    cells[idx].trueCount += 1;
    const clipped = Math.min(Math.max(r.income, 0), incomeClip);
    cells[idx].trueIncomeSum += clipped;
    trueTotalCount += 1;
    trueTotalIncome += clipped;
  }

  return { dimensions, dimDefs: defs, cells, index, trueTotalCount, trueTotalIncome };
}

/** 枚举某一维度方向上的所有"线"（固定其他维度、沿该维度变化的格子下标集合） */
export function linesAlongDimension(grid: Grid, dimPosition: number): number[][] {
  const otherPositions = grid.dimensions.map((_, i) => i).filter((i) => i !== dimPosition);
  const groups = new Map<string, number[]>();
  grid.cells.forEach((cell, idx) => {
    const lineKey = otherPositions.map((p) => cell.dimValues[p]).join('||');
    const arr = groups.get(lineKey);
    if (arr) arr.push(idx);
    else groups.set(lineKey, [idx]);
  });
  return [...groups.values()];
}
