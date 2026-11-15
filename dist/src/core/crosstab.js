export function buildCrossTab(rows, dimensions, metrics) {
    const sumFields = [
        ...new Set(metrics.filter((m) => m.kind !== 'count' && m.field).map((m) => m.field)),
    ];
    const clipOf = new Map();
    for (const m of metrics) {
        if (m.field && m.clipBound != null) {
            clipOf.set(m.field, Math.max(clipOf.get(m.field) ?? 0, m.clipBound));
        }
    }
    const domainSets = dimensions.map(() => new Set());
    const map = new Map();
    for (const row of rows) {
        const values = dimensions.map((d) => String(row[d] ?? '(空)'));
        values.forEach((v, i) => domainSets[i].add(v));
        const key = values.join('');
        let cell = map.get(key);
        if (!cell) {
            cell = { values, count: 0, sums: {} };
            for (const f of sumFields)
                cell.sums[f] = 0;
            map.set(key, cell);
        }
        cell.count += 1;
        for (const f of sumFields) {
            const raw = Number(row[f]);
            if (Number.isNaN(raw))
                continue;
            const clip = clipOf.get(f);
            const v = clip != null ? Math.min(Math.max(raw, 0), clip) : raw;
            cell.sums[f] += v;
        }
    }
    const domains = domainSets.map((s) => [...s].sort());
    const order = new Map();
    domains.forEach((dom, i) => dom.forEach((v, j) => order.set(`${i}${v}`, j)));
    const cells = [...map.values()].sort((a, b) => {
        for (let i = 0; i < dimensions.length; i++) {
            const d = (order.get(`${i}${a.values[i]}`) ?? 0) - (order.get(`${i}${b.values[i]}`) ?? 0);
            if (d !== 0)
                return d;
        }
        return 0;
    });
    return { dimensions, domains, cells, sumFields };
}
