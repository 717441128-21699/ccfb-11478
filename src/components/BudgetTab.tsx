import { useState } from 'react';
import { useApp } from '../store';
import { remainingBudget } from '../lib/mechanisms';
import { DEFAULT_TOTAL_EPSILON, DEFAULT_TOTAL_DELTA } from '../lib/storage';
import { DIMENSIONS, METRICS } from '../lib/dimensions';
import { fmtPct } from './format';
import type { DimensionKey, MetricKey } from '../lib/types';

export default function BudgetTab() {
  const { state, resetBudget, setTab } = useApp();
  const { budget, audit, designs } = state;
  const rem = remainingBudget(budget);
  const [epsInput, setEpsInput] = useState(budget.totalEpsilon);
  const [deltaInput, setDeltaInput] = useState(budget.totalDelta);

  const usedRatio = budget.totalEpsilon > 0 ? budget.usedEpsilon / budget.totalEpsilon : 0;
  const exhausted = rem.epsilon <= 1e-9;

  // 待发布设计的预算需求汇总
  const pendingNeed = designs.reduce((s, d) => s + d.epsilon, 0);

  return (
    <div>
      <div className="panel">
        <h2>③ 隐私预算账本</h2>
        <p className="desc">
          采用串行组合记账：每张表按其整表 ε 全额扣减（表内多指标均分该 ε），多表预算直接相加；δ 同理。
          总预算用完后发布动作会被强制拒绝。
        </p>

        <div className="budget-bar">
          <div className="budget-card">
            <div className="label">ε 总额 / 已用 / 剩余</div>
            <div className="value">{budget.totalEpsilon} / {budget.usedEpsilon.toFixed(3)} / {rem.epsilon.toFixed(3)}</div>
            <div className="progress-track">
              <div className={`progress-fill ${exhausted ? 'exhausted' : ''}`} style={{ width: `${Math.min(usedRatio * 100, 100)}%` }} />
            </div>
          </div>
          <div className="budget-card">
            <div className="label">δ 总额 / 已用 / 剩余</div>
            <div className="value" style={{ fontSize: 16 }}>
              {budget.totalDelta.toExponential(1)} / {budget.usedDelta.toExponential(1)} / {rem.delta.toExponential(1)}
            </div>
            <div className="sub">仅高斯机制消耗 δ</div>
          </div>
          <div className="budget-card">
            <div className="label">已发布表数</div>
            <div className="value">{audit.length}</div>
            <div className="sub">待发布设计 {designs.length} 张，合计还需 ε={pendingNeed.toFixed(3)}</div>
          </div>
          <div className="budget-card">
            <div className="label">预算状态</div>
            <div className="value">
              {exhausted ? <span className="tag danger">已耗尽</span> : <span className="tag ok">可发布</span>}
            </div>
            <div className="sub">{exhausted ? '新发布请求将被拒绝' : `还可承载约 ${Math.floor(rem.epsilon / 0.5)} 张 ε=0.5 的表`}</div>
          </div>
        </div>

        {exhausted && (
          <div className="alert error" style={{ marginTop: 14 }}>
            总 ε 预算已用完。任何新表发布都会被管线拒绝（抛出 BudgetExhaustedError），防止超预算的隐私损失累积。
            如需新一轮发布，可在下方重置账本（请确认数据使用合规流程已批准）。
          </div>
        )}

        <h3>总预算配置（重置将清零已用额度与审计，不影响原始数据）</h3>
        <div className="form-row">
          <div className="field">
            <label>总 ε</label>
            <input type="number" step="0.5" min="0.1" value={epsInput} onChange={(e) => setEpsInput(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>总 δ</label>
            <input type="number" step="1e-6" min="1e-9" value={deltaInput} onChange={(e) => setDeltaInput(Number(e.target.value))} />
          </div>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('确认重置预算账本并清空审计记录？')) resetBudget(epsInput || DEFAULT_TOTAL_EPSILON, deltaInput || DEFAULT_TOTAL_DELTA);
            }}
          >
            重置账本
          </button>
          <button className="btn" onClick={() => setTab('preview')}>去发布预览 →</button>
        </div>
      </div>

      <div className="panel">
        <h2>逐次发布的预算消耗明细</h2>
        {audit.length === 0 ? (
          <p className="muted">尚无发布记录。</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th className="dim">时间</th>
                  <th className="dim">发布表</th>
                  <th>机制</th>
                  <th>本次 ε</th>
                  <th>本次 δ</th>
                  <th>累计 ε 占比</th>
                  <th>发布后剩余 ε</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="dim mono" style={{ fontSize: 11 }}>{new Date(a.timestamp).toLocaleString('zh-CN')}</td>
                    <td className="dim">
                      {a.tableName}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {a.dimensions.map((d: DimensionKey) => DIMENSIONS[d].label).join(' × ')} · {a.metrics.map((m: MetricKey) => METRICS[m].label).join('、')}
                      </div>
                    </td>
                    <td><span className={`tag ${a.mechanism}`}>{a.mechanism === 'laplace' ? '拉普拉斯' : '高斯'}</span></td>
                    <td>{a.epsilonUsed.toFixed(3)}</td>
                    <td>{a.deltaUsed ? a.deltaUsed.toExponential(1) : '—'}</td>
                    <td>{fmtPct((budget.totalEpsilon - a.epsilonRemaining) / budget.totalEpsilon)}</td>
                    <td>{a.epsilonRemaining.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
