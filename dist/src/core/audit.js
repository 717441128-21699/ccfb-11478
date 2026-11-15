export class MemoryAuditStorage {
    data = null;
    load() {
        return this.data;
    }
    save(s) {
        this.data = s;
    }
}
export class AuditLog {
    storage;
    maxEntries;
    entries = [];
    constructor(storage, maxEntries = 1000) {
        this.storage = storage;
        this.maxEntries = maxEntries;
        const raw = storage.load();
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed))
                    this.entries = parsed;
            }
            catch {
                /* 损坏则从头开始 */
            }
        }
    }
    get all() {
        return this.entries;
    }
    get spentEpsilon() {
        return this.entries.reduce((a, e) => a + e.epsilon, 0);
    }
    get spentDelta() {
        return this.entries.reduce((a, e) => a + e.delta, 0);
    }
    record(entry) {
        const full = {
            ...entry,
            seq: this.entries.length + 1,
            cumulativeEpsilon: this.spentEpsilon + entry.epsilon,
            cumulativeDelta: this.spentDelta + entry.delta,
        };
        this.entries.push(full);
        if (this.entries.length > this.maxEntries)
            this.entries.shift();
        this.storage.save(JSON.stringify(this.entries));
        return full;
    }
    clear() {
        this.entries = [];
        this.storage.save('[]');
    }
}
