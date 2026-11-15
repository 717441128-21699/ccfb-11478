// 50 万合成人口生成器：带维度相关性的分层抽样，确定性（固定种子可复现）
// 仅用于演示与攻击验证，全部为虚构数据
import { DIMENSIONS } from './dimensions';
import type { PersonRecord } from './types';

/** splitmix64，输出 [0, 2^32) */
function splitmix64(state: bigint): { value: number; next: bigint } {
  let z = (state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
  z = z ^ (z >> 31n);
  return { value: Number(z & 0xffffffffn), next: (state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn };
}

class SeededRandom {
  private state: bigint;
  constructor(seed: number) {
    this.state = BigInt(seed >>> 0);
  }
  next(): number {
    const r = splitmix64(this.state);
    this.state = r.next;
    return r.value / 4294967296;
  }
  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** 按权重抽样下标 */
  weighted(weights: number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }
}

const DISTRICT_WEIGHTS = [
  0.13, 0.12, 0.11, 0.1, 0.11, 0.09, 0.08, 0.07, 0.06, 0.05, 0.045, 0.035,
];
const AGE_WEIGHTS = [0.16, 0.2, 0.27, 0.22, 0.15];
const GENDER_WEIGHTS = [0.505, 0.495];
// 教育随年龄段变化（老年人教育水平更低）
const EDU_BY_AGE: number[][] = [
  [0.42, 0.34, 0.14, 0.085, 0.015],
  [0.18, 0.3, 0.22, 0.24, 0.06],
  [0.1, 0.24, 0.24, 0.32, 0.1],
  [0.16, 0.32, 0.22, 0.24, 0.06],
  [0.38, 0.34, 0.14, 0.12, 0.02],
];
// 行业随教育水平变化
const OCC_BY_EDU: number[][] = [
  [0.3, 0.22, 0.02, 0.03, 0.18, 0.03, 0.16, 0.06],
  [0.24, 0.24, 0.05, 0.06, 0.1, 0.06, 0.16, 0.09],
  [0.16, 0.24, 0.12, 0.12, 0.04, 0.12, 0.1, 0.1],
  [0.1, 0.16, 0.22, 0.18, 0.02, 0.18, 0.06, 0.08],
  [0.04, 0.1, 0.28, 0.26, 0.01, 0.24, 0.03, 0.04],
];

/** 行业基础收入（元/年），教育与年龄在此基础上修正 */
const OCC_BASE_INCOME = [
  72000, 68000, 165000, 110000, 42000, 150000, 85000, 58000,
];
const EDU_INCOME_FACTOR = [0.72, 0.85, 1.0, 1.35, 1.9];
const AGE_INCOME_FACTOR = [0.25, 0.95, 1.25, 1.15, 0.55];

export interface GenerateOptions {
  n: number;
  seed: number;
  incomeClip: number;
}

export function generatePopulation(opts: GenerateOptions): PersonRecord[] {
  const rng = new SeededRandom(opts.seed);
  const districts = DIMENSIONS.district.values;
  const ages = DIMENSIONS.ageGroup.values;
  const genders = DIMENSIONS.gender.values;
  const edus = DIMENSIONS.education.values;
  const occs = DIMENSIONS.occupation.values;

  const records: PersonRecord[] = new Array(opts.n);
  for (let i = 0; i < opts.n; i++) {
    const district = districts[rng.weighted(DISTRICT_WEIGHTS)];
    const ageIdx = rng.weighted(AGE_WEIGHTS);
    const ageGroup = ages[ageIdx];
    const gender = genders[rng.weighted(GENDER_WEIGHTS)];
    const eduIdx = rng.weighted(EDU_BY_AGE[ageIdx]);
    const education = edus[eduIdx];
    const occIdx = rng.weighted(OCC_BY_EDU[eduIdx]);
    const occupation = occs[occIdx];

    const base =
      OCC_BASE_INCOME[occIdx] *
      EDU_INCOME_FACTOR[eduIdx] *
      AGE_INCOME_FACTOR[ageIdx];
    // 对数正态式乘性噪声
    let income = base * Math.exp(0.42 * rng.gaussian());
    if (ageIdx === 0) income *= 0.35; // 未成年人主要是零工/兼职
    income = Math.max(0, Math.min(opts.incomeClip, Math.round(income)));

    const householdSize = 1 + rng.weighted([0.12, 0.28, 0.3, 0.18, 0.08, 0.04]);

    records[i] = {
      id: `P${String(i + 1).padStart(6, '0')}`,
      district,
      ageGroup,
      gender,
      education,
      occupation,
      householdSize,
      income,
    };
  }
  return records;
}
