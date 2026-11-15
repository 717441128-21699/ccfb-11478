import { useApp, type TabKey } from '../store';
import DataTab from './DataTab';
import DesignTab from './DesignTab';
import BudgetTab from './BudgetTab';
import PreviewTab from './PreviewTab';
import AuditTab from './AuditTab';

const TABS: { key: TabKey; step: string; label: string }[] = [
  { key: 'data', step: '1', label: '原始数据' },
  { key: 'design', step: '2', label: '表格设计' },
  { key: 'budget', step: '3', label: '隐私预算' },
  { key: 'preview', step: '4', label: '发布预览' },
  { key: 'audit', step: '5', label: '审计记录' },
];

export function AppShell() {
  const { state, setTab } = useApp();
  const usedRatio = state.budget.totalEpsilon > 0 ? state.budget.usedEpsilon / state.budget.totalEpsilon : 0;

  return (
    <>
      <header className="app-header">
        <h1>
          区县人口收入数据 · 差分隐私发布工具
          <span className="privacy-badge">🔒 原始数据仅存本机内存，刷新即销毁，无任何网络上报</span>
        </h1>
        <p className="subtitle">
          拉普拉斯 / 高斯机制 · 串行预算记账 · 互补抑制防减法反推 · 一致性后处理 · 全流程审计
        </p>
      </header>
      <div className="layout">
        <nav className="sidenav">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`nav-item ${state.activeTab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className="nav-step">{t.step}</span>
              {t.label}
            </button>
          ))}
          <div style={{ marginTop: 18, padding: '0 14px', fontSize: 12 }} className="muted">
            <div style={{ marginBottom: 6 }}>
              预算使用 <strong>{(usedRatio * 100).toFixed(1)}%</strong>
            </div>
            <div className="progress-track">
              <div
                className={`progress-fill ${usedRatio >= 1 ? 'exhausted' : ''}`}
                style={{ width: `${Math.min(usedRatio * 100, 100)}%` }}
              />
            </div>
            <div style={{ marginTop: 8 }}>
              ε {state.budget.usedEpsilon.toFixed(3)} / {state.budget.totalEpsilon}
            </div>
          </div>
        </nav>
        <main className="content">
          {state.activeTab === 'data' && <DataTab />}
          {state.activeTab === 'design' && <DesignTab />}
          {state.activeTab === 'budget' && <BudgetTab />}
          {state.activeTab === 'preview' && <PreviewTab />}
          {state.activeTab === 'audit' && <AuditTab />}
        </main>
      </div>
    </>
  );
}
