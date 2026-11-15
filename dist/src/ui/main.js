// 浏览器端主逻辑:数据导入 / 表格设计 / 隐私预算 / 发布预览 / 审计记录
// 原始数据只在本机内存中处理,无任何网络请求。
import { AuditLog } from '../core/audit.js';
import { parseCsv, toCsv } from '../core/csv.js';
import { buildCrossTab } from '../core/crosstab.js';
import { errorBuckets } from '../core/errorModel.js';
import { BudgetAccountant, gaussianSigma, laplaceScale, planAtomicQueries, } from '../core/mechanisms.js';
import { releaseTable } from '../core/release.js';
import { cryptoRng, Sampler } from '../core/rng.js';
import { generatePopulation, INCOME_CLIP } from '../synth/population.js';
const state = {
    rows: null,
    header: [],
    profiles: [],
    plans: [],
    released: new Map(),
    previewCache: new Map(),
    planSeq: 0,
    dataSource: '',
};
const audit = new AuditLog({
    load: () => localStorage.getItem('dp.audit'),
    save: (s) => localStorage.setItem('dp.audit', s),
});
let totalEpsilon = Number(localStorage.getItem('dp.totalEps') ?? 8);
let totalDelta = Number(localStorage.getItem('dp.totalDelta') ?? 1e-5);
let accountant = new BudgetAccountant(0, 0);
function syncAccountant() {
    accountant = new BudgetAccountant(totalEpsilon, totalDelta);
    accountant.restore(audit.spentEpsilon, audit.spentDelta);
}
syncAccountant();
// ---------- 小工具 ----------
const main = document.getElementById('main');
const fmt = (n) => n.toLocaleString('zh-CN');
const pct = (x) => `${(x * 100).toFixed(2)}%`;
function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class')
            el.className = v;
        else
            el.setAttribute(k, v);
    }
    for (const c of children)
        el.append(c);
    return el;
}
function metricLabel(m) {
    if (m.kind === 'count')
        return '人口数';
    if (m.kind === 'sum')
        return `${m.field}·合计`;
    return `${m.field}·均值`;
}
function metricLabelPlain(m) {
    if (m.kind === 'count')
        return 'count';
    if (m.kind === 'sum')
        return `sum(${m.field})`;
    return `mean(${m.field})`;
}
// ---------- 页签 ----------
let activeTab = 'data';
document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn)
        return;
    activeTab = btn.dataset.tab;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    render();
});
const operatorInput = document.getElementById('operator');
operatorInput.value = localStorage.getItem('dp.operator') ?? '';
operatorInput.addEventListener('change', () => {
    localStorage.setItem('dp.operator', operatorInput.value.trim());
});
function render() {
    main.innerHTML = '';
    if (activeTab === 'data')
        renderData();
    else if (activeTab === 'design')
        renderDesign();
    else if (activeTab === 'budget')
        renderBudget();
    else if (activeTab === 'preview')
        renderPreview();
    else
        renderAudit();
}
// ---------- ① 原始数据 ----------
function renderData() {
    const p1 = h('section', { class: 'panel' }, h('h2', {}, '导入个人级数据'), h('p', { class: 'hint' }, '数据仅在本机浏览器内存中处理,不会发送到任何服务器。CSV 首行为字段名。'));
    const fileInput = h('input', { type: 'file', accept: '.csv,text/csv' });
    fileInput.addEventListener('change', async () => {
        const f = fileInput.files?.[0];
        if (!f)
            return;
        status.textContent = `正在解析 ${f.name}(${(f.size / 1024 / 1024).toFixed(1)} MB)…`;
        const text = await f.text();
        // 让出主线程,避免界面卡死
        await new Promise((r) => setTimeout(r, 30));
        const { header, rows } = parseCsv(text);
        loadData(header, rows, f.name);
    });
    const demoBtn = h('button', {}, '使用内置合成人口(50 万)');
    demoBtn.addEventListener('click', async () => {
        demoBtn.disabled = true;
        status.textContent = '正在本机生成 500,000 条合成人口记录…';
        await new Promise((r) => setTimeout(r, 30));
        const rows = generatePopulation(500_000);
        loadData(['id', 'county', 'sex', 'ageGroup', 'education', 'income'], rows, '内置合成人口');
        demoBtn.disabled = false;
    });
    const status = h('p', { class: 'hint' }, state.rows ? `已加载:${state.dataSource},${fmt(state.rows.length)} 行` : '尚未加载数据');
    p1.append(h('div', { class: 'row' }, fileInput, demoBtn), status);
    main.append(p1);
    if (state.rows) {
        const tbl = h('table', { class: 'grid' });
        tbl.append(h('tr', {}, h('th', {}, '字段'), h('th', {}, '类型'), h('th', {}, '取值数'), h('th', {}, '用途')));
        for (const p of state.profiles) {
            const sel = h('select', {});
            sel.append(h('option', { value: 'category' }, '分类(维度)'), h('option', { value: 'number' }, '数值(指标)'));
            sel.value = p.kind;
            sel.addEventListener('change', () => {
                p.kind = sel.value;
                state.previewCache.clear();
            });
            const usage = h('td', {}, p.kind === 'category' ? '可作交叉维度' : '可作求和/均值指标');
            sel.addEventListener('change', () => { usage.textContent = p.kind === 'category' ? '可作交叉维度' : '可作求和/均值指标'; });
            tbl.append(h('tr', {}, h('td', {}, p.name), h('td', {}, sel), h('td', {}, p.kind === 'category' ? fmt(p.distinct) : '—'), usage));
        }
        main.append(h('section', { class: 'panel' }, h('h2', {}, `字段概览(${state.dataSource})`), tbl));
    }
}
function loadData(header, rows, source) {
    state.rows = rows;
    state.header = header;
    state.dataSource = source;
    state.released.clear();
    state.previewCache.clear();
    // 字段画像:>90% 为数值则按数值列,否则分类列
    state.profiles = header.map((name) => {
        let numeric = 0;
        const values = new Set();
        const sample = Math.min(rows.length, 20000);
        for (let i = 0; i < sample; i++) {
            const v = rows[i][name];
            if (typeof v === 'number')
                numeric++;
            if (values.size < 5000)
                values.add(String(v));
        }
        const kind = numeric / sample > 0.9 ? 'number' : 'category';
        // 分类列统计全量取值数
        let distinct = values.size;
        if (kind === 'category') {
            const all = new Set();
            for (const r of rows)
                all.add(String(r[name]));
            distinct = all.size;
        }
        return { name, kind, distinct };
    });
    render();
}
// ---------- ② 表格设计 ----------
function renderDesign() {
    if (!state.rows) {
        main.append(h('div', { class: 'notice' }, '请先在「① 原始数据」中导入或生成数据。'));
        return;
    }
    const catCols = state.profiles.filter((p) => p.kind === 'category');
    const numCols = state.profiles.filter((p) => p.kind === 'number');
    // 维度选择(最多 3 个)
    const dimBoxes = [];
    const dimList = h('div', { class: 'checklist' });
    for (const p of catCols) {
        const box = h('input', { type: 'checkbox' });
        box.addEventListener('change', () => {
            const checked = dimBoxes.filter((d) => d.box.checked);
            dimBoxes.forEach((d) => (d.box.disabled = checked.length >= 3 && !d.box.checked));
        });
        dimBoxes.push({ name: p.name, box });
        dimList.append(h('label', {}, box, document.createTextNode(`${p.name}(${fmt(p.distinct)} 个取值)`)));
    }
    // 指标选择
    const countBox = h('input', { type: 'checkbox', checked: '' });
    const metricList = h('div', { class: 'checklist' }, h('label', {}, countBox, document.createTextNode('人口数(计数)')));
    const numInputs = [];
    for (const p of numCols) {
        const sumBox = h('input', { type: 'checkbox' });
        const meanBox = h('input', { type: 'checkbox' });
        const clip = h('input', { type: 'number', value: String(INCOME_CLIP), class: 'wide' });
        clip.title = '个人贡献截断上界:超过该值的收入按该值计,直接决定求和指标的敏感度';
        numInputs.push({ field: p.name, sumBox, meanBox, clip });
        metricList.append(h('label', {}, sumBox, document.createTextNode(`${p.name} · 合计`)));
        metricList.append(h('label', {}, meanBox, document.createTextNode(`${p.name} · 均值`)));
        metricList.append(h('label', { class: 'hint' }, document.createTextNode(`　└ ${p.name} 截断上界 `), clip));
    }
    // 机制与预算
    const mechSel = h('select', {}, h('option', { value: 'laplace' }, '拉普拉斯机制(纯 ε-DP)'), h('option', { value: 'gaussian' }, '高斯机制((ε, δ)-DP)'));
    const epsInput = h('input', { type: 'number', value: '1', step: '0.1', min: '0.01' });
    const deltaInput = h('input', { type: 'number', value: '0.000001', step: '0.000001', min: '0' });
    const deltaField = h('div', { class: 'field' }, h('label', {}, 'δ(高斯)'), deltaInput);
    mechSel.addEventListener('change', () => {
        deltaField.style.display = mechSel.value === 'gaussian' ? '' : 'none';
    });
    deltaField.style.display = 'none';
    const thrInput = h('input', { type: 'number', value: '5', min: '0' });
    const nameInput = h('input', { type: 'text', class: 'wide', placeholder: '留空自动命名' });
    const msg = h('p', { class: 'hint' }, '');
    const addBtn = h('button', { class: 'primary' }, '加入发布计划');
    addBtn.addEventListener('click', () => {
        const dims = dimBoxes.filter((d) => d.box.checked).map((d) => d.name);
        const metrics = [];
        if (countBox.checked)
            metrics.push({ kind: 'count' });
        for (const n of numInputs) {
            const clipBound = Math.max(1, Number(n.clip.value) || INCOME_CLIP);
            if (n.sumBox.checked)
                metrics.push({ kind: 'sum', field: n.field, clipBound });
            if (n.meanBox.checked)
                metrics.push({ kind: 'mean', field: n.field, clipBound });
        }
        const epsilon = Number(epsInput.value);
        const delta = mechSel.value === 'gaussian' ? Number(deltaInput.value) : 0;
        if (dims.length === 0) {
            msg.textContent = '请至少选择 1 个维度';
            msg.className = 'bad';
            return;
        }
        if (metrics.length === 0) {
            msg.textContent = '请至少选择 1 个指标';
            msg.className = 'bad';
            return;
        }
        if (!(epsilon > 0)) {
            msg.textContent = 'ε 必须为正数';
            msg.className = 'bad';
            return;
        }
        if (mechSel.value === 'gaussian' && !(delta > 0 && delta < 0.01)) {
            msg.textContent = '高斯机制需要 0 < δ < 0.01';
            msg.className = 'bad';
            return;
        }
        state.planSeq++;
        const spec = {
            id: `T${state.planSeq}`,
            name: nameInput.value.trim() || `${dims.join('×')} 交叉表`,
            dimensions: dims,
            metrics,
            mechanism: mechSel.value,
            epsilon,
            delta,
            suppressionThreshold: Math.max(0, Number(thrInput.value) || 0),
        };
        state.plans.push(spec);
        msg.textContent = '';
        render();
    });
    main.append(h('section', { class: 'panel' }, h('h2', {}, '设计要发布的交叉表'), h('div', { class: 'row' }, h('div', { class: 'col' }, h('h3', {}, '交叉维度(1–3 个)'), dimList), h('div', { class: 'col' }, h('h3', {}, '指标'), metricList), h('div', { class: 'col' }, h('h3', {}, '隐私机制与预算'), h('div', { class: 'field' }, h('label', {}, '加噪机制'), mechSel), h('div', { class: 'field' }, h('label', {}, '本表 ε'), epsInput), deltaField, h('div', { class: 'field' }, h('label', {}, '抑制阈值'), thrInput), h('div', { class: 'field' }, h('label', {}, '表名'), nameInput), addBtn, msg))));
    // 已排队计划
    if (state.plans.length) {
        const tbl = h('table', { class: 'grid' });
        tbl.append(h('tr', {}, h('th', {}, '编号'), h('th', {}, '表名'), h('th', {}, '维度'), h('th', {}, '指标'), h('th', {}, '机制'), h('th', {}, 'ε'), h('th', {}, 'δ'), h('th', {}, '抑制阈值'), h('th', {}, '')));
        for (const p of state.plans) {
            const epsCell = h('input', { type: 'number', value: String(p.epsilon), step: '0.1', min: '0.01' });
            epsCell.style.width = '80px';
            epsCell.addEventListener('change', () => {
                const v = Number(epsCell.value);
                if (v > 0) {
                    p.epsilon = v;
                    render();
                }
            });
            const del = h('button', { class: 'link' }, '删除');
            del.addEventListener('click', () => {
                state.plans = state.plans.filter((x) => x.id !== p.id);
                state.released.delete(p.id);
                render();
            });
            tbl.append(h('tr', {}, h('td', {}, p.id), h('td', {}, p.name), h('td', {}, p.dimensions.join(' × ')), h('td', {}, p.metrics.map(metricLabelPlain).join(', ')), h('td', {}, p.mechanism === 'laplace' ? '拉普拉斯' : '高斯'), h('td', {}, epsCell), h('td', {}, p.delta ? String(p.delta) : '0'), h('td', {}, String(p.suppressionThreshold)), h('td', {}, del)));
        }
        main.append(h('section', { class: 'panel' }, h('h2', {}, `发布计划(${state.plans.length} 张表)`), tbl, h('p', { class: 'hint' }, '提示:同一份数据每发布一次都消耗预算;重复发布同一表也会再次计费(这正是防止"两版相减"攻击的关键)。')));
    }
}
// ---------- ③ 隐私预算 ----------
function renderBudget() {
    const epsInput = h('input', { type: 'number', value: String(totalEpsilon), step: '1', min: '0.1' });
    const deltaInput = h('input', { type: 'number', value: String(totalDelta), step: '0.00001', min: '0' });
    const onChange = () => {
        totalEpsilon = Math.max(0.01, Number(epsInput.value) || 8);
        totalDelta = Math.max(0, Number(deltaInput.value) || 0);
        localStorage.setItem('dp.totalEps', String(totalEpsilon));
        localStorage.setItem('dp.totalDelta', String(totalDelta));
        syncAccountant();
        render();
    };
    epsInput.addEventListener('change', onChange);
    deltaInput.addEventListener('change', onChange);
    const spent = accountant.spent;
    const plannedEps = state.plans.filter((p) => !state.released.has(p.id)).reduce((a, p) => a + p.epsilon, 0);
    const remaining = totalEpsilon - spent.epsilon;
    const over = plannedEps > remaining + 1e-12;
    const bar = h('div', { class: 'budgetbar' });
    const w = (x) => `${Math.max(0, Math.min(100, (x / totalEpsilon) * 100))}%`;
    bar.append(h('div', { class: 'spent', style: `width:${w(spent.epsilon)}` }), h('div', { class: 'planned', style: `width:${w(Math.min(plannedEps, Math.max(0, remaining)))}` }), h('div', { class: 'free', style: `width:${w(Math.max(0, remaining - plannedEps))}` }));
    main.append(h('section', { class: 'panel' }, h('h2', {}, '隐私预算总量(基本组合:总 ε、δ 为各次发布之和)'), h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, '总预算 ε'), epsInput), h('div', { class: 'field' }, h('label', {}, '总预算 δ'), deltaInput)), bar, h('div', { class: 'legend' }, h('span', { class: 's1' }, `已消耗 ε=${spent.epsilon.toFixed(3)}(δ=${spent.delta.toExponential(1)})`), h('span', { class: 's2' }, `计划占用 ε=${plannedEps.toFixed(3)}`), h('span', { class: 's3' }, `剩余可用 ε=${Math.max(0, remaining - plannedEps).toFixed(3)}`)), over ? h('p', { class: 'bad' }, `⚠ 计划中的表合计 ε=${plannedEps.toFixed(3)},超出剩余预算 ${remaining.toFixed(3)},请下调单表 ε 或删除部分表。`) : h('p', { class: 'ok' }, '预算充足,可前往「④ 发布预览」评估误差并发布。'), h('p', { class: 'hint' }, '预算按表分配,可在「② 表格设计」的计划列表中逐表调整 ε;每次正式发布都会写入审计记录并永久扣减预算(刷新页面不重置)。')));
}
// ---------- ④ 发布预览 ----------
function renderPreview() {
    if (!state.rows) {
        main.append(h('div', { class: 'notice' }, '请先加载数据。'));
        return;
    }
    if (!state.plans.length) {
        main.append(h('div', { class: 'notice' }, '发布计划为空,请先在「② 表格设计」中添加。'));
        return;
    }
    for (const spec of state.plans) {
        main.append(previewPanel(spec));
    }
}
function previewPanel(spec) {
    const released = state.released.get(spec.id);
    const panel = h('section', { class: 'panel' });
    panel.append(h('h2', {}, `${spec.id} · ${spec.name} `, h('span', { class: 'badge' }, spec.mechanism === 'laplace' ? `拉普拉斯 ε=${spec.epsilon}` : `高斯 ε=${spec.epsilon}, δ=${spec.delta}`)));
    // 精确交叉表(本机计算,用于误差评估;不消耗预算)
    let tab = state.previewCache.get(spec.id);
    if (!tab) {
        tab = buildCrossTab(state.rows, spec.dimensions, spec.metrics);
        state.previewCache.set(spec.id, tab);
    }
    const queries = planAtomicQueries(spec);
    const scaleOf = (label) => {
        const q = queries.find((x) => x.label === label);
        if (!q)
            return null;
        return spec.mechanism === 'laplace'
            ? laplaceScale(q.sensitivity, q.epsilon)
            : gaussianSigma(q.sensitivity, q.epsilon, q.delta);
    };
    const willSuppress = tab.cells.filter((c) => c.count < spec.suppressionThreshold).length;
    panel.append(h('div', { class: 'kpi' }, kpi(fmt(tab.cells.length), '格子数'), kpi(fmt(willSuppress), `预计抑制(真值 < ${spec.suppressionThreshold})`), kpi(spec.dimensions.join(' × '), '维度'), kpi(spec.metrics.map(metricLabelPlain).join(', '), '指标')));
    if (!released) {
        // 误差评估(解析分布,按格子大小分桶)
        const qCount = scaleOf('count');
        if (qCount != null) {
            panel.append(h('h3', {}, `计数指标误差评估(噪声${spec.mechanism === 'laplace' ? '尺度 b' : 'σ'} = ${qCount.toFixed(2)})`), errorTable(errorBuckets(spec.mechanism, qCount, tab.cells.map((c) => c.count))));
        }
        for (const f of tab.sumFields) {
            const sc = scaleOf(`sum:${f}`);
            if (sc != null) {
                panel.append(h('h3', {}, `${f} 合计误差评估(噪声${spec.mechanism === 'laplace' ? '尺度 b' : 'σ'} = ${fmt(Math.round(sc))})`), errorTable(errorBuckets(spec.mechanism, sc, tab.cells.map((c) => c.sums[f]))));
            }
        }
        panel.append(h('p', { class: 'hint' }, '以上为发布前解析评估,不消耗预算;点击发布后一次性加噪、扣减预算并写入审计。'));
        const btn = h('button', { class: 'primary' }, `发布此表(消耗 ε=${spec.epsilon}${spec.delta ? `, δ=${spec.delta}` : ''})`);
        if (!accountant.canSpend(spec.epsilon, spec.delta)) {
            btn.disabled = true;
            btn.textContent = `预算不足(剩余 ε=${accountant.remaining.epsilon.toFixed(3)}),无法发布`;
        }
        btn.addEventListener('click', () => {
            try {
                const t = releaseTable(state.rows, spec, new Sampler(cryptoRng()));
                accountant.spend(spec.epsilon, spec.delta);
                audit.record({
                    timestamp: new Date().toISOString(),
                    operator: operatorInput.value.trim() || '未命名',
                    tableName: `${spec.id} ${spec.name}`,
                    dimensions: spec.dimensions,
                    metrics: spec.metrics.map(metricLabelPlain),
                    mechanism: spec.mechanism,
                    epsilon: spec.epsilon,
                    delta: spec.delta,
                    suppressionThreshold: spec.suppressionThreshold,
                    totalCells: t.stats.totalCells,
                    suppressedCells: t.stats.suppressedPrimary + t.stats.suppressedComplementary,
                });
                state.released.set(spec.id, t);
                render();
            }
            catch (err) {
                alert(`发布失败:${err.message}`);
            }
        });
        panel.append(btn);
    }
    else {
        panel.append(releasedView(released));
    }
    return panel;
}
function kpi(num, lbl) {
    return h('div', { class: 'item' }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, lbl));
}
function errorTable(buckets) {
    const tbl = h('table', { class: 'grid' });
    tbl.append(h('tr', {}, h('th', {}, '格子大小'), h('th', {}, '格子数'), h('th', {}, '典型相对误差(中位)'), h('th', {}, '95 分位相对误差')));
    for (const b of buckets) {
        tbl.append(h('tr', {}, h('td', {}, b.label), h('td', {}, fmt(b.cellCount)), h('td', {}, pct(b.typicalRelErr)), h('td', { class: b.p95RelErr > 0.05 ? 'warn' : 'ok' }, pct(b.p95RelErr))));
    }
    return tbl;
}
function releasedView(t) {
    const wrap = h('div', {});
    const s = t.stats;
    wrap.append(h('p', { class: 'ok' }, `✔ 已发布:格子 ${fmt(s.totalCells)},主抑制 ${s.suppressedPrimary},配合抑制 ${s.suppressedComplementary},实际发布 ${fmt(s.publishedCells)} 格。`));
    const tbl = h('table', { class: 'grid' });
    const metricHeads = t.spec.metrics.map((m) => h('th', {}, metricLabel(m)));
    tbl.append(h('tr', {}, ...t.spec.dimensions.map((d) => h('th', {}, d)), ...metricHeads, h('th', {}, '状态')));
    const MAX_ROWS = 300;
    const cells = t.cells.slice(0, MAX_ROWS);
    for (const c of cells) {
        const tds = [
            ...c.values.map((v) => h('td', {}, v)),
            ...c.metrics.map((m) => h('td', {}, c.suppressed ? '—' : m.kind === 'mean' ? m.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : fmt(m.value))),
            h('td', {}, c.suppressed ? (c.suppressReason === 'primary' ? '主抑制' : '配合抑制') : ''),
        ];
        tbl.append(h('tr', c.suppressed ? { class: 'suppressed' } : {}, ...tds));
    }
    if (t.cells.length > MAX_ROWS) {
        tbl.append(h('tr', {}, h('td', { colspan: '99', class: 'hint' }, `… 共 ${fmt(t.cells.length)} 行,仅显示前 ${MAX_ROWS} 行,完整内容请下载 CSV`)));
    }
    // 边际合计
    for (const m of t.margins) {
        const label = m.dims.length === 0 ? '总计' : `合计(${m.dims.map((d, i) => `${d}=${m.values[i]}`).join(', ')})`;
        const tds = [h('td', { colspan: String(t.spec.dimensions.length) }, label)];
        for (const met of m.metrics) {
            tds.push(h('td', {}, met.kind === 'mean' ? met.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : fmt(met.value)));
        }
        tds.push(h('td', {}, `${m.cellCount} 格汇总`));
        tbl.append(h('tr', { class: 'margin' }, ...tds));
    }
    wrap.append(h('div', { class: 'tablewrap' }, tbl));
    const dl = h('button', {}, '下载发布 CSV');
    dl.addEventListener('click', () => downloadCsv(t));
    wrap.append(h('p', {}, dl, h('span', { class: 'hint' }, ' CSV 中被抑制格子的数值为空,合计仅由已发布格子汇总。')));
    return wrap;
}
function downloadCsv(t) {
    const header = [...t.spec.dimensions, ...t.spec.metrics.map(metricLabelPlain), 'suppressed'];
    const rows = [];
    for (const c of t.cells) {
        rows.push([
            ...c.values,
            ...c.metrics.map((m) => (c.suppressed ? '' : m.value)),
            c.suppressed ? c.suppressReason ?? 'primary' : '',
        ]);
    }
    for (const m of t.margins) {
        const label = m.dims.length === 0 ? '(总计)' : `合计:${m.dims.map((d, i) => `${d}=${m.values[i]}`).join(',')}`;
        rows.push([label, ...Array(t.spec.dimensions.length - 1).fill(''), ...m.metrics.map((x) => x.value), 'margin']);
    }
    const blob = new Blob(['﻿' + toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${t.spec.id}_release.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}
// ---------- ⑤ 审计记录 ----------
function renderAudit() {
    const entries = audit.all;
    main.append(h('section', { class: 'panel' }, h('h2', {}, '发布审计(本地留存,可导出)'), h('div', { class: 'kpi' }, kpi(String(entries.length), '发布次数'), kpi(`ε=${audit.spentEpsilon.toFixed(3)}`, '累计消耗 ε'), kpi(`δ=${audit.spentDelta.toExponential(2)}`, '累计消耗 δ'), kpi(`ε=${(totalEpsilon - audit.spentEpsilon).toFixed(3)}`, '剩余 ε'))));
    if (!entries.length) {
        main.append(h('div', { class: 'notice' }, '暂无发布记录。'));
        return;
    }
    const tbl = h('table', { class: 'grid' });
    tbl.append(h('tr', {}, h('th', {}, '#'), h('th', {}, '时间'), h('th', {}, '操作员'), h('th', {}, '发布的表'), h('th', {}, '机制'), h('th', {}, 'ε'), h('th', {}, 'δ'), h('th', {}, '格子/抑制'), h('th', {}, '累计 ε')));
    for (const e of [...entries].reverse()) {
        tbl.append(h('tr', {}, h('td', {}, String(e.seq)), h('td', {}, new Date(e.timestamp).toLocaleString('zh-CN')), h('td', {}, e.operator), h('td', {}, `${e.tableName} [${e.dimensions.join('×')}] ${e.metrics.join(',')}`), h('td', {}, e.mechanism === 'laplace' ? '拉普拉斯' : '高斯'), h('td', {}, e.epsilon.toFixed(3)), h('td', {}, e.delta ? e.delta.toExponential(1) : '0'), h('td', {}, `${fmt(e.totalCells)} / ${fmt(e.suppressedCells)}`), h('td', {}, e.cumulativeEpsilon.toFixed(3))));
    }
    const exportBtn = h('button', {}, '导出审计 JSON');
    exportBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `dp_audit_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    });
    const clearBtn = h('button', { class: 'danger' }, '清空审计并重置已耗预算');
    clearBtn.addEventListener('click', () => {
        if (!confirm('确定清空全部审计记录?已耗预算将一并重置(仅适用于演示/测试)。'))
            return;
        audit.clear();
        syncAccountant();
        state.released.clear();
        render();
    });
    main.append(h('section', { class: 'panel' }, h('div', { class: 'tablewrap' }, tbl), h('p', {}, exportBtn, document.createTextNode(' '), clearBtn)));
}
render();
