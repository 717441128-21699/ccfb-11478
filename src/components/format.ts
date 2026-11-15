// 通用展示辅助
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('zh-CN');
}

export function fmtPct(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `¥${Math.round(n).toLocaleString('zh-CN')}`;
}

export function shortId(prefix: string): string {
  const buf = new Uint32Array(2);
  globalThis.crypto.getRandomValues(buf);
  return `${prefix}-${buf[0].toString(36)}${buf[1].toString(36)}`;
}
