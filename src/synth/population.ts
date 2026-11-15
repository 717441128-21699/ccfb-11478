// 合成人口生成器:50 万条个人级记录,统计性质接近真实人口
// 维度:区县、性别、年龄段、受教育程度;指标:年收入(元)
import { Sampler, seededRng } from '../core/rng.js';
import type { Row } from '../core/types.js';

export const COUNTIES = [
  '城东区', '城西区', '城南区', '城北区', '高新区', '经开区',
  '临港区', '江夏县', '青山县', '云梦县', '桃源县', '望江县',
];

export const AGE_GROUPS = [
  '0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80+',
];

export const EDUCATION = ['小学及以下', '初中', '高中/中专', '大专及以上'];

// 各区县人口权重(大致符合"中心密、外围疏")
const COUNTY_W = [0.16, 0.14, 0.12, 0.11, 0.1, 0.09, 0.07, 0.06, 0.05, 0.04, 0.03, 0.03];
// 年龄结构
const AGE_W = [0.11, 0.12, 0.14, 0.16, 0.15, 0.13, 0.1, 0.06, 0.03];
// 教育程度随年龄变化(年轻人学历更高)
const EDU_W_BY_AGE: number[][] = [
  [0.95, 0.04, 0.01, 0.0],
  [0.35, 0.45, 0.18, 0.02],
  [0.04, 0.2, 0.36, 0.4],
  [0.06, 0.26, 0.38, 0.3],
  [0.12, 0.34, 0.34, 0.2],
  [0.22, 0.38, 0.28, 0.12],
  [0.4, 0.34, 0.18, 0.08],
  [0.55, 0.3, 0.11, 0.04],
  [0.65, 0.25, 0.08, 0.02],
];
// 教育对收入的基础倍数
const EDU_INCOME_FACTOR = [0.55, 0.8, 1.0, 1.6];
// 年龄收入曲线(中年达峰)
const AGE_INCOME_FACTOR = [0.05, 0.25, 0.85, 1.15, 1.3, 1.15, 0.7, 0.4, 0.25];
// 区县经济水平
const COUNTY_INCOME_FACTOR = [1.25, 1.2, 1.1, 1.05, 1.3, 1.15, 0.95, 0.85, 0.8, 0.75, 0.7, 0.7];

const BASE_INCOME = 72000; // 基准年收入(元)
export const INCOME_CLIP = 1_000_000; // 默认截断上界 100 万

function pickWeighted(u: number, weights: number[]): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (u < acc) return i;
  }
  return weights.length - 1;
}

export function generatePopulation(n: number, seed = 20261115): Row[] {
  const sampler = new Sampler(seededRng(seed));
  const u = () => sampler.next();
  const rows: Row[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const countyIdx = pickWeighted(u(), COUNTY_W);
    const ageIdx = pickWeighted(u(), AGE_W);
    const eduIdx = pickWeighted(u(), EDU_W_BY_AGE[ageIdx]);
    const sex = u() < 0.51 ? '男' : '女';
    // 对数正态收入:log(mean) 由结构项决定,乘上个体噪声
    const structural =
      BASE_INCOME *
      EDU_INCOME_FACTOR[eduIdx] *
      AGE_INCOME_FACTOR[ageIdx] *
      COUNTY_INCOME_FACTOR[countyIdx];
    const logNoise = sampler.standardNormal() * 0.45;
    let income = Math.round(structural * Math.exp(logNoise));
    if (income < 0) income = 0;
    // 极少数高收入离群值(测试截断与敏感度)
    if (u() < 0.001) income = Math.round(income * (3 + u() * 10));
    rows[i] = {
      id: i + 1,
      county: COUNTIES[countyIdx],
      sex,
      ageGroup: AGE_GROUPS[ageIdx],
      education: EDUCATION[eduIdx],
      income,
    };
  }
  return rows;
}

export const POPULATION_HEADER = ['id', 'county', 'sex', 'ageGroup', 'education', 'income'];
