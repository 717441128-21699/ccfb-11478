// 全局应用状态：原始微数据仅存内存（关闭/刷新即销毁）；预算账本与审计持久化到 localStorage
import { createContext, useContext, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import { inferDimensionDefs } from './lib/dimensions';
import {
  loadBudget,
  saveBudget,
  loadAudit,
  appendAudit,
  clearAudit,
  resetBudget,
} from './lib/storage';
import { publishTable } from './lib/pipeline';
import { Rng } from './lib/rng';
import type {
  AuditEntry,
  BudgetAccount,
  DimensionDef,
  DimensionKey,
  PersonRecord,
  PublishedTable,
  TableDesign,
} from './lib/types';

export type TabKey = 'data' | 'design' | 'budget' | 'preview' | 'audit';

interface AppState {
  records: PersonRecord[];
  dataName: string;
  dimDefs: Record<DimensionKey, DimensionDef> | null;
  budget: BudgetAccount;
  audit: AuditEntry[];
  published: PublishedTable[];
  designs: TableDesign[];
  activeTab: TabKey;
  operator: string;
  lastError: string | null;
}

type Action =
  | { type: 'LOAD_DATA'; records: PersonRecord[]; name: string }
  | { type: 'CLEAR_DATA' }
  | { type: 'SET_TAB'; tab: TabKey }
  | { type: 'SET_OPERATOR'; operator: string }
  | { type: 'UPSERT_DESIGN'; design: TableDesign }
  | { type: 'REMOVE_DESIGN'; id: string }
  | { type: 'PUBLISH'; table: PublishedTable; audit: AuditEntry }
  | { type: 'RESET_BUDGET'; totalEpsilon: number; totalDelta: number }
  | { type: 'CLEAR_AUDIT' }
  | { type: 'SET_ERROR'; message: string | null };

const initialState: AppState = {
  records: [],
  dataName: '',
  dimDefs: null,
  budget: loadBudget(),
  audit: loadAudit(),
  published: [],
  designs: [],
  activeTab: 'data',
  operator: '统计员',
  lastError: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_DATA':
      return {
        ...state,
        records: action.records,
        dataName: action.name,
        dimDefs: inferDimensionDefs(action.records),
        lastError: null,
      };
    case 'CLEAR_DATA':
      return { ...state, records: [], dataName: '', dimDefs: null, published: [], designs: [] };
    case 'SET_TAB':
      return { ...state, activeTab: action.tab, lastError: null };
    case 'SET_OPERATOR':
      return { ...state, operator: action.operator };
    case 'UPSERT_DESIGN': {
      const idx = state.designs.findIndex((d) => d.id === action.design.id);
      const designs =
        idx >= 0
          ? state.designs.map((d) => (d.id === action.design.id ? action.design : d))
          : [...state.designs, action.design];
      return { ...state, designs };
    }
    case 'REMOVE_DESIGN':
      return { ...state, designs: state.designs.filter((d) => d.id !== action.id) };
    case 'PUBLISH':
      // budget 已由 pipeline 原地扣减并经 saveBudget 持久化，这里不可重复累加
      return {
        ...state,
        published: [action.table, ...state.published],
        audit: [action.audit, ...state.audit],
        lastError: null,
      };
    case 'RESET_BUDGET':
      return { ...state, budget: resetBudget(action.totalEpsilon, action.totalDelta) };
    case 'CLEAR_AUDIT':
      clearAudit();
      return { ...state, audit: [] };
    case 'SET_ERROR':
      return { ...state, lastError: action.message };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  loadData: (records: PersonRecord[], name: string) => void;
  clearData: () => void;
  setTab: (tab: TabKey) => void;
  setOperator: (name: string) => void;
  upsertDesign: (design: TableDesign) => void;
  removeDesign: (id: string) => void;
  publish: (design: TableDesign) => PublishedTable;
  resetBudget: (totalEpsilon: number, totalDelta: number) => void;
  clearAuditLog: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      loadData: (records, name) => dispatch({ type: 'LOAD_DATA', records, name }),
      clearData: () => dispatch({ type: 'CLEAR_DATA' }),
      setTab: (tab) => dispatch({ type: 'SET_TAB', tab }),
      setOperator: (operator) => dispatch({ type: 'SET_OPERATOR', operator }),
      upsertDesign: (design) => dispatch({ type: 'UPSERT_DESIGN', design }),
      removeDesign: (id) => dispatch({ type: 'REMOVE_DESIGN', id }),
      publish: (design) => {
        if (!state.dimDefs) throw new Error('尚未导入数据');
        try {
          const rng = new Rng();
          const { table, audit } = publishTable(design, {
            records: state.records,
            dimDefs: state.dimDefs,
            budget: state.budget,
            rng,
            operator: state.operator,
          });
          saveBudget(state.budget);
          appendAudit(audit);
          dispatch({ type: 'PUBLISH', table, audit });
          return table;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          dispatch({ type: 'SET_ERROR', message: msg });
          throw e;
        }
      },
      resetBudget: (totalEpsilon, totalDelta) =>
        dispatch({ type: 'RESET_BUDGET', totalEpsilon, totalDelta }),
      clearAuditLog: () => dispatch({ type: 'CLEAR_AUDIT' }),
    }),
    [state],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}
