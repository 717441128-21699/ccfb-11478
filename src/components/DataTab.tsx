import { useRef, useState } from 'react';
import { useApp } from '../store';
import { parseCsv } from '../lib/csv';
import { generatePopulation } from '../lib/synthetic';
import { DIMENSIONS, DIMENSION_ORDER } from '../lib/dimensions';
import { fmtInt, fmtMoney } from './format';

const SAMPLE_SIZES = [50000, 200000, 500000];

export default function DataTab() {
  const { state, loadData, clearData, setTab } = useApp();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const records = parseCsv(text);
      loadData(records, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadSample = (n: number) => {
    setLoading(n.toString());
    setError(null);
    // 让 loading 状态先渲染，再执行生成（50 万条约 1~2 秒）
    setTimeout(() => {
      try {
        const records = generatePopulation({ n, seed: 20261116, incomeClip: 200000 });
        loadData(records, `合成人口 ${n.toLocaleString()} 人（内置生成器）`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(null);
      }
    }, 30);
  };

  const hasData = state.records.length > 0;
  const meanIncome = hasData
    ? state.records.reduce((s, r) => s + r.income, 0) / state.records.length
    : 0;

  return (
    <div>
      <div className="panel">
        <h2>① 导入个人级数据</h2>
        <p className="desc">
          支持 UTF-8 CSV，必需列：id, district, ageGroup, gender, education, occupation, householdSize, income。
          文件只在浏览器本机内存中解析，不会上传到任何服务器。
        </p>

        {error && <div className="alert error">导入失败：{error}</div>}

        {!hasData ? (
          <>
            <div
              className={`file-drop ${dragging ? 'dragging' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFile(f);
              }}
            >
              <div style={{ fontSize: 30 }}>📂</div>
              <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>点击选择或拖拽 CSV 到此处</div>
              <div>数据不离开本机 · 关闭页面即从内存清除</div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
            </div>
            <h3>没有数据？生成一份合成人口用于演练</h3>
            <div className="form-row">
              {SAMPLE_SIZES.map((n) => (
                <button
                  key={n}
                  className="btn"
                  disabled={loading !== null}
                  onClick={() => loadSample(n)}
                >
                  {loading === n.toString() ? '生成中…' : `生成 ${fmtInt(n)} 人`}
                </button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              合成数据按区县/年龄/性别/教育/行业分层抽样，收入与行业、教育、年龄相关，全部为虚构记录。
            </p>
          </>
        ) : (
          <div>
            <div className="alert success">
              已载入 <strong>{state.dataName}</strong>，共 <strong>{fmtInt(state.records.length)}</strong> 条个人记录，仅存于本机内存。
            </div>
            <div className="metric-grid">
              <div className="metric-tile">
                <div className="m-label">记录数</div>
                <div className="m-value">{fmtInt(state.records.length)}</div>
              </div>
              <div className="metric-tile">
                <div className="m-label">平均年收入</div>
                <div className="m-value">{fmtMoney(meanIncome)}</div>
              </div>
              <div className="metric-tile">
                <div className="m-label">区县数</div>
                <div className="m-value">{state.dimDefs?.district.values.length ?? 0}</div>
              </div>
              <div className="metric-tile">
                <div className="m-label">维度组合空间</div>
                <div className="m-value">
                  {DIMENSION_ORDER.reduce(
                    (p, k) => p * (state.dimDefs?.[k].values.length ?? DIMENSIONS[k].values.length),
                    1,
                  ).toLocaleString()}
                </div>
              </div>
            </div>

            <h3>各维度取值分布</h3>
            <div className="two-col">
              {DIMENSION_ORDER.map((key) => {
                const counts = new Map<string, number>();
                for (const r of state.records) {
                  const v = r[key] as string;
                  counts.set(v, (counts.get(v) ?? 0) + 1);
                }
                return (
                  <div key={key}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{DIMENSIONS[key].label}</div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <tbody>
                          {[...counts.entries()]
                            .sort((a, b) => b[1] - a[1])
                            .map(([v, c]) => (
                              <tr key={v}>
                                <td className="dim">{v}</td>
                                <td>{fmtInt(c)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>

            <h3>前 5 条原始记录预览（仅本机可见）</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    {['id', '区县', '年龄段', '性别', '教育', '行业', '家庭规模', '收入'].map((h) => (
                      <th key={h} className="dim">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.records.slice(0, 5).map((r) => (
                    <tr key={r.id}>
                      <td className="dim mono">{r.id}</td>
                      <td className="dim">{r.district}</td>
                      <td className="dim">{r.ageGroup}</td>
                      <td className="dim">{r.gender}</td>
                      <td className="dim">{r.education}</td>
                      <td className="dim">{r.occupation}</td>
                      <td>{r.householdSize}</td>
                      <td>{fmtMoney(r.income)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="form-row" style={{ marginTop: 16 }}>
              <button className="btn primary" onClick={() => setTab('design')}>
                下一步：设计交叉表 →
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (confirm('确认清除本机内存中的原始数据？')) clearData();
                }}
              >
                清除原始数据
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
