import { useApp } from '../store';
import { DIMENSIONS, METRICS } from '../lib/dimensions';
import { fmtInt, fmtPct } from './format';
import type { AuditEntry, DimensionKey, MetricKey } from '../lib/types';

function auditToCsv(rows: AuditEntry[]): string {
  const header = [
    '审计ID', '时间(UTC)', '操作员', '表名', '表设计ID', '机制', '维度', '指标',
    '消耗ε', '消耗δ', '剩余ε', '剩余δ', '格子数', '抑制格子数', '数据行数', '大格子最大相对误差',
  ];
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((a) =>
    [
      a.id, a.timestamp, a.operator, a.tableName, a.tableId, a.mechanism,
      a.dimensions.map((d: DimensionKey) => DIMENSIONS[d].label).join('×'),
      a.metrics.map((m: MetricKey) => METRICS[m].label).join('/'),
      a.epsilonUsed, a.deltaUsed, a.epsilonRemaining, a.deltaRemaining,
      a.cellCount, a.suppressedCellCount, a.dataRowCount,
      (a.largeCellMaxRelativeError * 100).toFixed(4) + '%',
    ]
      .map(esc)
      .join(','),
  );
  return [header.join(','), ...lines].join('\r\n');
}

export default function AuditTab() {
  const { state, clearAuditLog, setOperator } = useApp();
  const rows = state.audit;

  const exportCsv = () => {
    const blob = new Blob([`﻿${auditToCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `差分隐私发布审计-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="panel">
      <h2>⑤ 审计记录</h2>
      <p className="desc">
        每次发布成功后自动写入，持久化在本机浏览器（localStorage）。记录"谁在什么时间、对哪批数据、发布了什么表、消耗多少预算"，
        不含任何原始个人数据。
      </p>

      <div className="form-row">
        <div className="field">
          <label>当前操作员身份（写入后续审计）</label>
          <input
            value={state.operator}
            onChange={(e) => setOperator(e.target.value)}
            style={{ minWidth: 240 }}
          />
        </div>
        <button className="btn" disabled={rows.length === 0} onClick={exportCsv}>导出审计 CSV</button>
        <button
          className="btn danger"
          disabled={rows.length === 0}
          onClick={() => {
            if (confirm('确认清空全部审计记录？此操作不可恢复。')) clearAuditLog();
          }}
        >
          清空审计
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="muted">暂无审计记录。</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table audit-table">
            <thead>
              <tr>
                <th className="dim">时间</th>
                <th className="dim">操作员</th>
                <th className="dim">发布表 / 维度 / 指标</th>
                <th>机制</th>
                <th>数据行数</th>
                <th>格子(抑制)</th>
                <th>消耗 ε</th>
                <th>消耗 δ</th>
                <th>剩余 ε</th>
                <th>大格子最大误差</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="dim mono" style={{ fontSize: 11 }}>
                    {new Date(a.timestamp).toLocaleString('zh-CN')}
                    <div className="muted" style={{ fontSize: 10 }}>{a.id}</div>
                  </td>
                  <td className="dim">{a.operator}</td>
                  <td className="dim">
                    <strong>{a.tableName}</strong>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {a.dimensions.map((d: DimensionKey) => DIMENSIONS[d].label).join(' × ')}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {a.metrics.map((m: MetricKey) => METRICS[m].label).join('、')}
                    </div>
                  </td>
                  <td><span className={`tag ${a.mechanism}`}>{a.mechanism === 'laplace' ? '拉普拉斯' : '高斯'}</span></td>
                  <td>{fmtInt(a.dataRowCount)}</td>
                  <td>
                    {a.cellCount}
                    <span className="tag warn" style={{ marginLeft: 4 }}>抑 {a.suppressedCellCount}</span>
                  </td>
                  <td>{a.epsilonUsed.toFixed(3)}</td>
                  <td>{a.deltaUsed ? a.deltaUsed.toExponential(1) : '—'}</td>
                  <td>{a.epsilonRemaining.toFixed(3)}</td>
                  <td>{fmtPct(a.largeCellMaxRelativeError)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="alert info" style={{ marginTop: 16 }}>
        审计完整性提示：本工具审计存于本机浏览器，适合部门内部留痕。若需防篡改，应由组织把审计 CSV 定期归档到
        只追加（append-only）的日志系统；审计字段中刻意不含任何格子真实值或个人记录。
      </div>
    </div>
  );
}
