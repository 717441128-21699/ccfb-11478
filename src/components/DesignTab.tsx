import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { DIMENSIONS, DIMENSION_ORDER, METRICS, METRIC_ORDER } from '../lib/dimensions';
import { laplaceScale, gaussianSigma, remainingBudget } from '../lib/mechanisms';
import { buildGrid } from '../lib/aggregation';
import { planSuppression } from '../lib/suppression';
import { MIN_SUPPRESSION_GROUP } from '../lib/pipeline';
import { shortId } from './format';
import type { DimensionKey, Mechanism, MetricKey, TableDesign } from '../lib/types';
const MAX_DIMENSIONS = 4;

export default function DesignTab() {
  const { state, upsertDesign, removeDesign, setTab } = useApp();
  const rem = remainingBudget(state.budget);

  const [name, setName] = useState('新交叉表');
  const [dims, setDims] = useState<DimensionKey[]>(['district', 'ageGroup']);
  const [metrics, setMetrics] = useState<MetricKey[]>(['count', 'incomeSum', 'incomeMean']);
  const [mechanism, setMechanism] = useState<Mechanism>('laplace');
  const [epsilon, setEpsilon] = useState(0.8);
  const [delta, setDelta] = useState(1e-6);
  const [threshold, setThreshold] = useState(5);
  const [incomeClip, setIncomeClip] = useState(200000);

  const hasData = state.records.length > 0;

  const preview = useMemo(() => {
    if (!hasData || !state.dimDefs) return null;
    const grid = buildGrid(state.records, dims, state.dimDefs, incomeClip);
    const suppression = planSuppression(grid, threshold, MIN_SUPPRESSION_GROUP);
    return {
      totalCells: grid.cells.length,
      suppressed: suppression.pooledGroupSize,
      empty: grid.cells.filter((c) => c.trueCount === 0).length,
      smallest: Math.min(...grid.cells.map((c) => c.trueCount)),
      largest: Math.max(...grid.cells.map((c) => c.trueCount)),
    };
  }, [hasData, state.dimDefs, state.records, dims, threshold, incomeClip]);

  const activeBaseMetrics = metrics.filter((m) => m !== 'incomeMean');
  const epsPerMetric = epsilon / Math.max(activeBaseMetrics.length, 1);

  const noiseInfo = useMemo(() => {
    const spec = (sensitivity: number) => ({
      mechanism,
      epsilon: epsPerMetric,
      delta,
      sensitivityL1: sensitivity,
      sensitivityL2: sensitivity,
    });
    if (mechanism === 'laplace') {
      return {
        countB: laplaceScale(spec(METRICS.count.sensitivity)),
        incomeB: laplaceScale(spec(incomeClip)),
      };
    }
    return {
      countB: gaussianSigma(spec(METRICS.count.sensitivity)),
      incomeB: gaussianSigma(spec(incomeClip)),
    };
  }, [mechanism, epsPerMetric, delta, incomeClip]);

  const toggleDim = (key: DimensionKey) => {
    setDims((prev) =>
      prev.includes(key)
        ? prev.filter((d) => d !== key)
        : prev.length >= MAX_DIMENSIONS
          ? prev
          : [...prev, key],
    );
  };

  const toggleMetric = (key: MetricKey) => {
    setMetrics((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
  };

  const overBudget = epsilon > rem.epsilon + 1e-12 || (mechanism === 'gaussian' && delta > rem.delta + 1e-15);
  const invalid =
    dims.length === 0 ||
    activeBaseMetrics.length === 0 ||
    epsilon <= 0 ||
    (mechanism === 'gaussian' && (delta <= 0 || delta >= 1 || epsPerMetric >= 1));

  const save = () => {
    if (invalid || overBudget || !hasData) return;
    const design: TableDesign = {
      id: shortId('tbl'),
      name: name.trim() || '未命名交叉表',
      dimensions: dims,
      metrics,
      mechanism,
      epsilon,
      delta: mechanism === 'gaussian' ? delta : 0,
      suppressThreshold: threshold,
      incomeClip,
    };
    upsertDesign(design);
    setTab('preview');
  };

  if (!hasData) {
    return (
      <div className="panel">
        <h2>② 设计要发布的交叉表</h2>
        <div className="alert info">请先在「原始数据」页导入或生成数据。</div>
        <button className="btn primary" onClick={() => setTab('data')}>去导入数据 →</button>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>② 设计要发布的交叉表</h2>
      <p className="desc">
        选择 1~{MAX_DIMENSIONS} 个行维度与发布指标；噪声尺度随预算实时估算。人均收入为派生指标（收入总额/计数），不单独消耗预算。
      </p>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>表名称</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 320 }} />
      </div>

      <h3>行维度（最多 {MAX_DIMENSIONS} 个，按选择顺序排列）</h3>
      <div className="checkbox-group">
        {DIMENSION_ORDER.map((key) => (
          <label key={key} className="check-pill">
            <input
              type="checkbox"
              checked={dims.includes(key)}
              onChange={() => toggleDim(key)}
            />
            {DIMENSIONS[key].label}
          </label>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        当前顺序：{dims.map((d) => DIMENSIONS[d].label).join(' × ') || '（未选择）'}
      </p>

      <h3>发布指标</h3>
      <div className="checkbox-group">
        {METRIC_ORDER.map((key) => (
          <label key={key} className="check-pill">
            <input
              type="checkbox"
              checked={metrics.includes(key)}
              onChange={() => toggleMetric(key)}
            />
            {METRICS[key].label}
          </label>
        ))}
      </div>
      {metrics.includes('incomeMean') && !metrics.includes('incomeSum') && (
        <div className="alert error" style={{ marginTop: 10 }}>人均收入依赖收入总额，请同时勾选「收入总额」。</div>
      )}

      <h3>加噪机制与隐私预算</h3>
      <div className="form-row">
        <div className="field">
          <label>机制</label>
          <select value={mechanism} onChange={(e) => setMechanism(e.target.value as Mechanism)}>
            <option value="laplace">拉普拉斯 Laplace（(ε,0)-DP）</option>
            <option value="gaussian">高斯 Gaussian（(ε,δ)-DP）</option>
          </select>
        </div>
        <div className="field">
          <label>本表 ε 预算（剩余 {rem.epsilon.toFixed(3)}）</label>
          <input
            type="number"
            step="0.1"
            min="0.05"
            value={epsilon}
            onChange={(e) => setEpsilon(Number(e.target.value))}
          />
        </div>
        {mechanism === 'gaussian' && (
          <div className="field">
            <label>δ（剩余 {rem.delta.toExponential(1)}，需 0&lt;δ&lt;1）</label>
            <input
              type="number"
              step="1e-7"
              min="1e-9"
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value))}
            />
          </div>
        )}
        <div className="field">
          <label>抑制阈值（真实计数 &lt; 该值则抑制）</label>
          <input
            type="number"
            step="1"
            min="1"
            value={threshold}
            onChange={(e) => setThreshold(Math.max(1, Number(e.target.value)))}
          />
        </div>
        <div className="field">
          <label>收入裁剪上界（元，决定收入敏感度）</label>
          <input
            type="number"
            step="10000"
            min="10000"
            value={incomeClip}
            onChange={(e) => setIncomeClip(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="two-col">
        <div className="metric-tile">
          <div className="m-label">计数噪声尺度（{mechanism === 'laplace' ? 'b' : 'σ'}）</div>
          <div className="m-value">{noiseInfo.countB.toFixed(3)} 人</div>
          <div className="m-label">单指标 ε={epsPerMetric.toFixed(3)}（表 ε 在 {activeBaseMetrics.length} 个基础指标间均分）</div>
        </div>
        <div className="metric-tile">
          <div className="m-label">收入总额噪声尺度（{mechanism === 'laplace' ? 'b' : 'σ'}）</div>
          <div className="m-value">¥{Math.round(noiseInfo.incomeB).toLocaleString()}</div>
          <div className="m-label">敏感度 = 裁剪上界 ¥{incomeClip.toLocaleString()}</div>
        </div>
      </div>

      {preview && (
        <>
          <h3>当前设计下的真实网格预览（基于本机数据，不参与发布）</h3>
          <div className="metric-grid">
            <div className="metric-tile">
              <div className="m-label">格子总数</div>
              <div className="m-value">{preview.totalCells.toLocaleString()}</div>
            </div>
            <div className="metric-tile">
              <div className="m-label">预计抑制格子</div>
              <div className="m-value">
                {preview.suppressed}
                <span className="muted">（含互补抑制，汇总桶 ≥{MIN_SUPPRESSION_GROUP} 格）</span>
              </div>
            </div>
            <div className="metric-tile">
              <div className="m-label">空格子</div>
              <div className="m-value">{preview.empty}</div>
            </div>
            <div className="metric-tile">
              <div className="m-label">格子真实计数范围</div>
              <div className="m-value">{preview.smallest} ~ {preview.largest.toLocaleString()}</div>
            </div>
          </div>
        </>
      )}

      {overBudget && (
        <div className="alert error" style={{ marginTop: 14 }}>
          本表申请的预算超过剩余预算（ε 剩余 {rem.epsilon.toFixed(3)}，δ 剩余 {rem.delta.toExponential(1)}），无法发布。
        </div>
      )}
      {mechanism === 'gaussian' && epsPerMetric >= 1 && (
        <div className="alert error" style={{ marginTop: 14 }}>高斯经典校准要求单指标 ε &lt; 1，请增大表预算或减少指标。</div>
      )}

      <div className="form-row" style={{ marginTop: 18 }}>
        <button className="btn primary" disabled={invalid || overBudget} onClick={save}>
          保存设计并去发布 →
        </button>
        <button className="btn" onClick={() => setTab('budget')}>查看预算账本</button>
      </div>

      {state.designs.length > 0 && (
        <>
          <h3>已保存的表设计（{state.designs.length}）</h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="dim">表名</th>
                  <th className="dim">维度</th>
                  <th className="dim">指标</th>
                  <th>机制</th>
                  <th>ε</th>
                  <th>δ</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.designs.map((d) => (
                  <tr key={d.id}>
                    <td className="dim">{d.name}</td>
                    <td className="dim">{d.dimensions.map((x: DimensionKey) => DIMENSIONS[x].label).join(' × ')}</td>
                    <td className="dim">{d.metrics.map((x: MetricKey) => METRICS[x].label).join('、')}</td>
                    <td><span className={`tag ${d.mechanism}`}>{d.mechanism === 'laplace' ? '拉普拉斯' : '高斯'}</span></td>
                    <td>{d.epsilon}</td>
                    <td>{d.delta ? d.delta.toExponential(1) : '—'}</td>
                    <td>
                      <button className="btn small danger" onClick={() => removeDesign(d.id)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
