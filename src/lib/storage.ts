// 本地持久化：预算账本与审计记录只写浏览器 localStorage，原始微数据不落盘
import type { AuditEntry, BudgetAccount } from './types';

const BUDGET_KEY = 'dp-publisher:budget-v1';
const AUDIT_KEY = 'dp-publisher:audit-v1';

export const DEFAULT_TOTAL_EPSILON = 4;
export const DEFAULT_TOTAL_DELTA = 1e-5;

export function loadBudget(): BudgetAccount {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    if (raw) return JSON.parse(raw) as BudgetAccount;
  } catch {
    /* 损坏则重置 */
  }
  return {
    totalEpsilon: DEFAULT_TOTAL_EPSILON,
    totalDelta: DEFAULT_TOTAL_DELTA,
    usedEpsilon: 0,
    usedDelta: 0,
  };
}

export function saveBudget(account: BudgetAccount): void {
  localStorage.setItem(BUDGET_KEY, JSON.stringify(account));
}

export function resetBudget(totalEpsilon: number, totalDelta: number): BudgetAccount {
  const account: BudgetAccount = {
    totalEpsilon,
    totalDelta,
    usedEpsilon: 0,
    usedDelta: 0,
  };
  saveBudget(account);
  return account;
}

export function loadAudit(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    if (raw) return JSON.parse(raw) as AuditEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

export function appendAudit(entry: AuditEntry): AuditEntry[] {
  const all = loadAudit();
  all.unshift(entry);
  localStorage.setItem(AUDIT_KEY, JSON.stringify(all));
  return all;
}

export function clearAudit(): void {
  localStorage.removeItem(AUDIT_KEY);
}
