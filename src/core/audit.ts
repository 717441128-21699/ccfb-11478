 // 审计日志:每次发布留痕(谁、何时、发了什么、花了多少预算)
import type { AuditEntry } from './types.js';

/** 存储接口:浏览器传 localStorage 封装,脚本用内存实现 */
export interface AuditStorage {
  load(): string | null;
  save(serialized: string): void;
}

export class MemoryAuditStorage implements AuditStorage {
  private data: string | null = null;
  load() {
    return this.data;
  }
  save(s: string) {
    this.data = s;
  }
}

export class AuditLog {
  private entries: AuditEntry[] = [];

  constructor(private storage: AuditStorage, private maxEntries = 1000) {
    const raw = storage.load();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.entries = parsed;
      } catch {
        /* 损坏则从头开始 */
      }
    }
  }

  get all(): readonly AuditEntry[] {
    return this.entries;
  }

  get spentEpsilon(): number {
    return this.entries.reduce((a, e) => a + e.epsilon, 0);
  }
  get spentDelta(): number {
    return this.entries.reduce((a, e) => a + e.delta, 0);
  }

  record(entry: Omit<AuditEntry, 'seq' | 'cumulativeEpsilon' | 'cumulativeDelta'>): AuditEntry {
    const full: AuditEntry = {
      ...entry,
      seq: this.entries.length + 1,
      cumulativeEpsilon: this.spentEpsilon + entry.epsilon,
      cumulativeDelta: this.spentDelta + entry.delta,
    };
    this.entries.push(full);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    this.storage.save(JSON.stringify(this.entries));
    return full;
  }

  clear(): void {
    this.entries = [];
    this.storage.save('[]');
  }
}
