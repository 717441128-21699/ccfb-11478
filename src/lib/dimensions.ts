// 维度与指标的固定字典（与合成数据生成器保持一致）
import type { DimensionDef, DimensionKey, MetricDef, MetricKey, PersonRecord } from './types';

export const DIMENSIONS: Record<DimensionKey, DimensionDef> = {
  district: {
    key: 'district',
    label: '区县',
    values: [
      '城东区', '城西区', '城南区', '城北区', '高新区',
      '临江新区', '青山县', '龙泉县', '白沙县', '石门县',
      '云溪县', '金凤县',
    ],
  },
  ageGroup: {
    key: 'ageGroup',
    label: '年龄段',
    values: ['0-17', '18-29', '30-44', '45-59', '60+'],
  },
  gender: {
    key: 'gender',
    label: '性别',
    values: ['男', '女'],
  },
  education: {
    key: 'education',
    label: '受教育程度',
    values: ['初中及以下', '高中/中专', '大专', '本科', '研究生'],
  },
  occupation: {
    key: 'occupation',
    label: '行业',
    values: ['制造业', '服务业', '信息技术', '教育医疗', '农业', '金融商务', '建筑业', '其他'],
  },
};

export const DIMENSION_ORDER: DimensionKey[] = [
  'district', 'ageGroup', 'gender', 'education', 'occupation',
];

export const METRICS: Record<MetricKey, MetricDef> = {
  count: { key: 'count', label: '人数（计数）', sensitivity: 1, isInteger: true },
  incomeSum: { key: 'incomeSum', label: '收入总额（元）', sensitivity: 200000, isInteger: true },
  incomeMean: { key: 'incomeMean', label: '人均收入（元）', sensitivity: 200000, isInteger: false, isDerived: true },
};

export const METRIC_ORDER: MetricKey[] = ['count', 'incomeSum', 'incomeMean'];

/** 数据集中实际出现的维度值域（导入数据后按数据推断，缺失值归入各自字典） */
export function inferDimensionDefs(records: PersonRecord[]): Record<DimensionKey, DimensionDef> {
  const present: Record<DimensionKey, Set<string>> = {
    district: new Set(),
    ageGroup: new Set(),
    gender: new Set(),
    education: new Set(),
    occupation: new Set(),
  };
  for (const r of records) {
    present.district.add(r.district);
    present.ageGroup.add(r.ageGroup);
    present.gender.add(r.gender);
    present.education.add(r.education);
    present.occupation.add(r.occupation);
  }
  const out = {} as Record<DimensionKey, DimensionDef>;
  for (const key of DIMENSION_ORDER) {
    out[key] = {
      ...DIMENSIONS[key],
      values: DIMENSIONS[key].values.filter((v) => present[key].has(v)),
    };
  }
  return out;
}
