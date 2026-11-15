import { useState } from 'react';
import { useApp } from '../store';
import { DIMENSIONS, METRICS } from '../lib/dimensions';
import { tableToCsv } from '../lib/csv';
import { LARGE_CELL_THRESHOLD } from '../lib/errors';
import { fmtInt, fmtPct, fmtMoney } from './format';
import type { DimensionKey, MetricKey, PublishedTable } from '../lib/types';

function downloadCsv(table: PublishedTable): void {
  const csv = tableToCsv(table);
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${table.design.name}-dp发布.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ErrorPanel({ table }: { table: PublishedTable }) {
  const c = table.errorSummary.count;
  const inc = table.errorSummary.incomeSum;
  return (
    <div className="panel">
      <h2>发布前误差评估（按格子真实规模）</h2>
      <p className="desc">
        相对误差 = |发布值 − 真实值| / max(真实值, 1)，仅统计未抑制格子；大格子定义为真实计数 ≥ {LARGE_CELL_THRESHOLD.toLocaleString()}。
      </p>
      <h3>计数指标</h3>
      <div className="metric-grid">
        <div className="metric-tile"><div className="m-label">参与格子数</div><div className="m-value">{c.cellCount}</div></div>
        <div className="metric-tile"><div className="m-label">平均相对误差</div><div className="m-value">{fmtPct(c.meanRelativeError)}</div></div>
        <div className="metric-tile"><div className="m-label">中位数</div><div className="m-value">{fmtPct(c.medianRelativeError)}</div></div>
        <div className="metric-tile"><div className="m-label">P90</div><div className="m-value">{fmtPct(c.p90RelativeError)}</div></div>
        <div className="metric-tile"><div className="m-label">最大值</div><div className="m-value">{fmtPct(c.maxRelativeError)}</div></div>
        <div className={`metric-tile ${c.largeCellMaxRelativeError < 0.05 ? '' : ''}`}>
          <div className="m-label">大格子最大相对误差（{c.largeCellCount} 格）</div>
          <div className="m-value" style={{ color: c.largeCellMaxRelativeError < 0.05 ? 'var(--ok)' : 'var(--danger)' }}>
            {fmtPct(c.largeCellMaxRelativeError)}
          </div>
          <div className="m-label">{c.largeCellMaxRelativeError < 0.05 ? '✓ 满足 5% 精度要求' : '✗ 超过 5%，请增大 ε'}</div>
        </div>
      </div>
      {inc && (
        <>
          <h3>收入总额指标</h3>
          <div className="metric-grid">
            <div className="metric-tile"><div className="m-label">参与格子数</div><div className="m-value">{inc.cellCount}</div></div>
            <div className="metric-tile"><div className="m-label">平均相对误差</div><div className="m-value">{fmtPct(inc.meanRelativeError)}</div></div>
            <div className="metric-tile"><div className="m-label">中位数</div><div className="m-value">{fmtPct(inc.medianRelativeError)}</div></div>
            <div className="metric-tile"><div className="m-label">P90</div><div className="m-value">{fmtPct(inc.p90RelativeError)}</div></div>
            <div className="metric-tile"><div className="m-label">大格子最大相对误差（{inc.largeCellCount} 格）</div><div className="m-value">{fmtPct(inc.largeCellMaxRelativeError)}</div></div>
          </div>
        </>
      )}
    </div>
  );
}

function TableView({ table }: { table: PublishedTable }) {
  const dimCount = table.dimDefs.length;
  const showIncome = table.design.metrics.includes('incomeSum') || table.design.metrics.includes('incomeMean');
  const showMean = table.design.metrics.includes('incomeMean');

  return (
    <div className="panel">
      <h2>
        发布预览：{table.design.name}
        <span className={`tag ${table.design.mechanism}`} style={{ marginLeft: 10 }}>
          {table.design.mechanism === 'laplace' ? '拉普拉斯' : '高斯'} ε={table.design.epsilon}
        </span>
        <span className="tag warn" style={{ marginLeft: 6 }}>抑制 {table.suppressedCellCount} 格</span>
      </h2>
      <p className="desc">
        表中全部为加噪并经一致性后处理的发布值；被抑制格子只汇总进「抑制项」桶，不出现单格数据。
        子项加总严格等于合计（整数、非负）。
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {table.dimDefs.map((d) => (
                <th key={d.key} className="dim">{d.label}</th>
              ))}
              <th>发布人数</th>
              {showIncome && <th>发布收入总额</th>}
              {showMean && <th>人均收入</th>}
              <th>相对误差(人数)</th>
            </tr>
          </thead>
          <tbody>
            {table.cells.map((c) =>
              c.suppressed ? null : (
                <tr key={c.key}>
                  {c.dimValues.map((v, i) => (
                    <td key={i} className="dim">{v}</td>
                  ))}
                  <td>{fmtInt(c.noisyCount)}</td>
                  {showIncome && <td>{fmtMoney(c.noisyIncomeSum)}</td>}
                  {showMean && <td>{fmtMoney(c.incomeMean)}</td>}
                  <td>{fmtPct(c.countRelativeError)}</td>
                </tr>
              ),
            )}
            <tr className="suppressed-row">
              {Array.from({ length: dimCount }, (_, i) => (
                <td key={i} className="dim">{i === 0 ? `【抑制项汇总（${table.suppressedCellCount} 格）】` : ''}</td>
              ))}
              <td>{fmtInt(table.publishedSuppressedCount)}</td>
              {showIncome && <td>{fmtMoney(table.publishedSuppressedIncomeSum)}</td>}
              {showMean && (
                <td>
                  {table.publishedSuppressedCount > 0
                    ? fmtMoney(table.publishedSuppressedIncomeSum / table.publishedSuppressedCount)
                    : '—'}
                </td>
              )}
              <td>
                {fmtPct(
                  Math.abs(table.publishedSuppressedCount - table.trueSuppressedCount) /
                    Math.max(table.trueSuppressedCount, 1),
                )}
              </td>
            </tr>
            <tr className="total-row">
              {Array.from({ length: dimCount }, (_, i) => (
                <td key={i} className="dim">{i === 0 ? '【合计】' : ''}</td>
              ))}
              <td>{fmtInt(table.publishedTotalCount)}</td>
              {showIncome && <td>{fmtMoney(table.publishedTotalIncomeSum)}</td>}
              {showMean && <td>{fmtMoney(table.publishedTotalIncomeSum / table.publishedTotalCount)}</td>}
              <td>
                {fmtPct(
                  Math.abs(table.publishedTotalCount - table.trueTotalCount) /
                    Math.max(table.trueTotalCount, 1),
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="form-row" style={{ marginTop: 14 }}>
        <button className="btn primary" onClick={() => downloadCsv(table)}>导出发布 CSV（仅含发布值）</button>
      </div>
    </div>
  );
}

export default function PreviewTab() {
  const { state, publish, setTab } = useApp();
  const [selectedId, setSelectedId] = useState<string>(state.designs[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  const design = state.designs.find((d) => d.id === selectedId) ?? state.designs[0];

  const doPublish = () => {
    if (!design) return;
    setError(null);
    try {
      publish(design);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (state.records.length === 0) {
    return (
      <div className="panel">
        <h2>④ 发布预览</h2>
        <div className="alert info">请先导入数据。</div>
        <button className="btn primary" onClick={() => setTab('data')}>去导入数据 →</button>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h2>④ 选择表设计并发布</h2>
        {state.designs.length === 0 ? (
          <>
            <div className="alert info">还没有保存的表设计。</div>
            <button className="btn primary" onClick={() => setTab('design')}>去设计交叉表 →</button>
          </>
        ) : (
          <>
            <div className="form-row">
              <div className="field">
                <label>待发布表</label>
                <select
                  value={design?.id ?? ''}
                  onChange={(e) => setSelectedId(e.target.value)}
                  style={{ minWidth: 360 }}
                >
                  {state.designs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}（{d.dimensions.map((x: DimensionKey) => DIMENSIONS[x].label).join('×')}，ε={d.epsilon}，
                      {d.metrics.map((m: MetricKey) => METRICS[m].label).join('/')}）
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn primary" onClick={doPublish}>
                🔒 执行加噪发布（扣减预算并写审计）
              </button>
            </div>
            {error && <div className="alert error">发布被拒绝：{error}</div>}
            <p className="muted" style={{ fontSize: 12 }}>
              发布操作在本机完成：每个格子独立加噪 → 抑制汇总 → 非负/整数/合计一致性后处理 → 生成审计记录。
              同一张表可多次发布（每次重新抽样噪声并独立扣预算）。
            </p>
          </>
        )}
      </div>

      {state.published.map((t) => (
        <div key={`${t.design.id}-${t.createdAt}`}>
          <ErrorPanel table={t} />
          <TableView table={t} />
        </div>
      ))}
    </div>
  );
}
