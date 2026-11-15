// 差分隐私发布流水线验证脚本
//
// 在 50 万合成人口上:
//   A. 精度:大格子相对误差 ≤ 5%(P95)
//   B. 一致性:非负、整数、子项加总 = 合计
//   C. 预算:总预算耗尽后拒绝发布
//   D. 攻击1(差分攻击):两版发布相减反推个人收入 —— 加噪后失败
//   E. 攻击2(成员推断):判断某人是否在库 —— 成功率贴近随机
//   F. 攻击3(抑制反解):用边际合计减出被抑制格子 —— 方程欠定,不可唯一解
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../src/core/csv.js';
import { buildCrossTab } from '../src/core/crosstab.js';
import { BudgetAccountant } from '../src/core/mechanisms.js';
import { releaseTable } from '../src/core/release.js';
import { Sampler, seededRng } from '../src/core/rng.js';
import { checkComplementarySuppression } from '../src/core/suppress.js';
import { INCOME_CLIP } from '../src/synth/population.js';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rows = parseCsv(readFileSync(join(root, 'data', 'population.csv'), 'utf8')).rows;
console.log(`数据:${rows.length.toLocaleString()} 行\n`);
// ---------- 检查框架 ----------
let failures = 0;
function check(name, ok, detail) {
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
    if (!ok)
        failures++;
}
const pct = (x) => `${(x * 100).toFixed(2)}%`;
function p95(xs) {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))];
}
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
};
// ---------- 发布计划(与工具默认一致) ----------
const PLANS = [
    { id: 'T1', name: '分区县×性别 人口与收入', dimensions: ['county', 'sex'],
        metrics: [{ kind: 'count' }, { kind: 'sum', field: 'income', clipBound: INCOME_CLIP }, { kind: 'mean', field: 'income', clipBound: INCOME_CLIP }],
        mechanism: 'laplace', epsilon: 1, delta: 0, suppressionThreshold: 5 },
    { id: 'T2', name: '分区县×年龄段 人口与收入', dimensions: ['county', 'ageGroup'],
        metrics: [{ kind: 'count' }, { kind: 'sum', field: 'income', clipBound: INCOME_CLIP }, { kind: 'mean', field: 'income', clipBound: INCOME_CLIP }],
        mechanism: 'laplace', epsilon: 1, delta: 0, suppressionThreshold: 5 },
    { id: 'T3', name: '分区县×年龄段×性别 人口(高斯)', dimensions: ['county', 'ageGroup', 'sex'],
        metrics: [{ kind: 'count' }],
        mechanism: 'gaussian', epsilon: 1, delta: 1e-6, suppressionThreshold: 5 },
    { id: 'T4', name: '分区县×受教育程度 人口与收入', dimensions: ['county', 'education'],
        metrics: [{ kind: 'count' }, { kind: 'sum', field: 'income', clipBound: INCOME_CLIP }],
        mechanism: 'laplace', epsilon: 1, delta: 0, suppressionThreshold: 5 },
    { id: 'T5', name: '分区县×年龄段×受教育程度 人口(含小格子)', dimensions: ['county', 'ageGroup', 'education'],
        metrics: [{ kind: 'count' }],
        mechanism: 'laplace', epsilon: 1, delta: 0, suppressionThreshold: 5 },
];
const accountant = new BudgetAccountant(8, 1e-5);
const sampler = new Sampler(seededRng(42));
const released = [];
console.log('== 发布一批表(总预算 ε=8, δ=1e-5)==');
for (const spec of PLANS) {
    if (!accountant.canSpend(spec.epsilon, spec.delta)) {
        console.log(`  ${spec.id} 预算不足,拒绝`);
        continue;
    }
    const t = releaseTable(rows, spec, sampler);
    accountant.spend(spec.epsilon, spec.delta);
    released.push(t);
    console.log(`  ${spec.id} ${spec.name}:格子 ${t.stats.totalCells},` +
        `抑制 ${t.stats.suppressedPrimary}+${t.stats.suppressedComplementary}(配合),` +
        `累计 ε=${accountant.spent.epsilon.toFixed(2)}`);
}
// ---------- A. 大格子精度 ----------
console.log('\n== A. 精度:大格子相对误差 ==');
for (const t of released) {
    const truth = buildCrossTab(rows, t.spec.dimensions, t.spec.metrics);
    const trueByKey = new Map(truth.cells.map((c) => [c.values.join(''), c]));
    const countErrs = [];
    const sumErrs = [];
    for (const c of t.cells) {
        if (c.suppressed)
            continue;
        const key = c.values.join('');
        const tr = trueByKey.get(key);
        if (!tr)
            continue;
        const mCount = c.metrics.find((m) => m.kind === 'count');
        if (mCount && tr.count >= 500)
            countErrs.push(Math.abs(mCount.value - tr.count) / tr.count);
        for (const m of c.metrics) {
            if (m.kind === 'sum' && tr.sums[m.field] >= 2e8) {
                sumErrs.push(Math.abs(m.value - tr.sums[m.field]) / tr.sums[m.field]);
            }
        }
    }
    if (countErrs.length) {
        check(`${t.spec.id} 计数格子(≥500)P95 相对误差 ≤ 5%`, p95(countErrs) <= 0.05, `n=${countErrs.length}, P95=${pct(p95(countErrs))}, 中位=${pct(median(countErrs))}, 最大=${pct(Math.max(...countErrs))}`);
    }
    if (sumErrs.length) {
        check(`${t.spec.id} 收入合计格子(≥2亿)P95 相对误差 ≤ 5%`, p95(sumErrs) <= 0.05, `n=${sumErrs.length}, P95=${pct(p95(sumErrs))}, 中位=${pct(median(sumErrs))}, 最大=${pct(Math.max(...sumErrs))}`);
    }
}
// ---------- B. 一致性 ----------
console.log('\n== B. 一致性后处理 ==');
for (const t of released) {
    let nonNegInt = true;
    for (const c of t.cells) {
        for (const m of c.metrics) {
            if (m.kind === 'mean')
                continue;
            if (m.value < 0 || !Number.isInteger(m.value))
                nonNegInt = false;
        }
    }
    check(`${t.spec.id} 计数/求和均为非负整数`, nonNegInt, '');
    // 边际合计 = 已发布格子之和(逐组核对)
    let marginsOk = true;
    const published = t.cells.filter((c) => !c.suppressed);
    const grand = t.margins.find((m) => m.dims.length === 0);
    if (grand) {
        // 计数合计核对
        const countIdx = t.spec.metrics.findIndex((m) => m.kind === 'count');
        if (countIdx >= 0) {
            const sumCells = published.reduce((a, c) => a + c.metrics[countIdx].value, 0);
            if (sumCells !== grand.metrics[countIdx].value)
                marginsOk = false;
        }
        const sumIdx = t.spec.metrics.findIndex((m) => m.kind === 'sum');
        if (sumIdx >= 0) {
            const sumCells = published.reduce((a, c) => a + c.metrics[sumIdx].value, 0);
            if (sumCells !== grand.metrics[sumIdx].value)
                marginsOk = false;
        }
    }
    check(`${t.spec.id} 子项加总 = 合计(基于已发布格子)`, marginsOk, '');
}
// ---------- C. 预算耗尽拒绝 ----------
console.log('\n== C. 隐私预算控制 ==');
{
    const acc = new BudgetAccountant(2, 1e-6);
    acc.spend(1, 0);
    acc.spend(1, 1e-6);
    let threw = false;
    try {
        acc.spend(0.5, 0);
    }
    catch {
        threw = true;
    }
    check('总预算耗尽后拒绝再发', threw && !acc.canSpend(0.01, 0), `已用 ε=${acc.spent.epsilon}, 再申请 ε=0.5 被拒绝`);
}
// ---------- D. 攻击1:差分攻击(两版发布相减) ----------
console.log('\n== D. 攻击1:差分攻击(新旧两版表相减,反推个人收入)==');
{
    const victimIncome = 888_888;
    // 场景:受害者(青山县, 20-29, 收入 888,888)新迁入,统计部门先后发布两版
    // "区县×年龄段 收入合计"表(各花 ε=1,拉普拉斯)。攻击者将两版相减,
    // 差值即为受害者收入 —— 不加噪时成立,加噪后应失败。
    // 逐格噪声相互独立,这里直接对目标格子按发布管线的同样数学过程模拟
    // (加噪 → 非负截断 → 取整),避免每次试验重算 50 万行交叉表。
    const spec = {
        id: 'ATK', name: '区县×年龄段 收入合计', dimensions: ['county', 'ageGroup'],
        metrics: [{ kind: 'sum', field: 'income', clipBound: INCOME_CLIP }],
        mechanism: 'laplace', epsilon: 1, delta: 0, suppressionThreshold: 5,
    };
    const truthBefore = buildCrossTab(rows, spec.dimensions, spec.metrics);
    const cell = truthBefore.cells.find((c) => c.values.join('') === '青山县20-29');
    const sumBefore = cell.sums['income'];
    const sumAfter = sumBefore + victimIncome; // 受害者收入低于截断上界,全额计入
    const b = INCOME_CLIP / spec.epsilon; // 该表只有 1 个原子查询,独享 ε
    const TRIALS = 20000;
    const samp = new Sampler(seededRng(1000));
    const dpErr = [];
    let dpClose = 0;
    for (let i = 0; i < TRIALS; i++) {
        const rel1 = Math.round(Math.max(0, sumBefore + samp.laplace(b)));
        const rel2 = Math.round(Math.max(0, sumAfter + samp.laplace(b)));
        const est = rel2 - rel1; // 攻击者的个人收入估计
        const err = Math.abs(est - victimIncome) / victimIncome;
        dpErr.push(err);
        if (err <= 0.1)
            dpClose++;
    }
    // 对照:不加噪时同一攻击(同一管线,ε 极大 ≈ 无噪声)
    const plainSpec = { ...spec, epsilon: 1e9 };
    const s0 = new Sampler(seededRng(7));
    const b0 = releaseTable(rows, plainSpec, s0);
    const a0 = releaseTable([...rows, { id: 999999, county: '青山县', sex: '女', ageGroup: '20-29', education: '高中/中专', income: victimIncome }], plainSpec, s0);
    const key = '青山县20-29';
    const plainEst = a0.cells.find((c) => c.values.join('') === key).metrics[0].value -
        b0.cells.find((c) => c.values.join('') === key).metrics[0].value;
    const plainErr = Math.abs(plainEst - victimIncome) / victimIncome;
    console.log(`  对照(无噪声):攻击者估计 ${plainEst.toLocaleString()},相对误差 ${pct(plainErr)} → 个人收入被精确反推`);
    check('加噪后差分攻击失败', dpClose / TRIALS < 0.05 && plainErr < 0.01, `加噪后估计误差中位数 ${pct(median(dpErr))},误差≤10% 的比例仅 ${pct(dpClose / TRIALS)}(${TRIALS} 次试验)`);
}
// ---------- E. 攻击2:成员推断 ----------
console.log('\n== E. 攻击2:成员推断(判断目标个人是否在库)==');
{
    // 攻击者知道除目标外的全部数据,看到目标所在格子的加噪计数,猜测目标是否在库
    const EPS_Q = 0.5; // 单个计数查询分到的预算
    const b = 1 / EPS_Q;
    const fine = buildCrossTab(rows, ['county', 'ageGroup', 'sex'], [{ kind: 'count' }]);
    const cellCounts = fine.cells.map((c) => c.count);
    const TRIALS = 20000;
    const rng = seededRng(555);
    const samp = new Sampler(rng);
    let correctDp = 0;
    let correctPlain = 0;
    for (let i = 0; i < TRIALS; i++) {
        const cellIdx = Math.floor(rng() * cellCounts.length);
        const nIn = cellCounts[cellIdx]; // 目标在库时的格子计数
        const included = rng() < 0.5;
        const trueCount = included ? nIn : nIn - 1;
        const threshold = nIn - 0.5; // 最优判决门限
        // 加噪发布
        const noisy = trueCount + samp.laplace(b);
        if (noisy >= threshold === included)
            correctDp++;
        // 对照:无噪声
        if (trueCount >= threshold === included)
            correctPlain++;
    }
    const accDp = correctDp / TRIALS;
    const accPlain = correctPlain / TRIALS;
    const bound = Math.exp(EPS_Q) / (1 + Math.exp(EPS_Q)); // DP 理论上限
    console.log(`  对照(无噪声):攻击成功率 ${pct(accPlain)} → 完全泄露`);
    check('加噪后成员推断贴近随机', accDp <= bound + 0.02, `加噪后成功率 ${pct(accDp)}(随机=50%, ε=${EPS_Q} 的理论上限 ${pct(bound)})`);
}
// ---------- F. 攻击3:抑制格子的减法反解 ----------
console.log('\n== F. 攻击3:用边际合计反解被抑制格子 ==');
for (const t of released) {
    const r = checkComplementarySuppression(t.cells, t.spec.dimensions.length);
    check(`${t.spec.id} 每行/列抑制格子数为 0 或 ≥2(减法反解欠定)`, r.ok, r.ok ? `抑制 ${t.stats.suppressedPrimary + t.stats.suppressedComplementary} 格,含配合抑制 ${t.stats.suppressedComplementary} 格`
        : r.violations.join(';'));
    // 发布的边际合计只含已发布格子:攻击者拿不到任何含被抑制格的合计
    const grand = t.margins.find((m) => m.dims.length === 0);
    if (grand) {
        const countIdx = t.spec.metrics.findIndex((m) => m.kind === 'count');
        if (countIdx >= 0) {
            const publishedSum = t.cells.filter((c) => !c.suppressed)
                .reduce((a, c) => a + c.metrics[countIdx].value, 0);
            check(`${t.spec.id} 发布的总计不含被抑制格子`, grand.metrics[countIdx].value === publishedSum, `总计=${grand.metrics[countIdx].value.toLocaleString()}(仅已发布格子之和)`);
        }
    }
}
console.log(`\n${failures === 0 ? '全部检查通过 ✔' : `${failures} 项检查失败 ✘`}`);
process.exit(failures === 0 ? 0 : 1);
