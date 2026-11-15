// 一致性后处理:非负化 + 保总整数舍入
//
// 顺序:加噪 → 截断到 ≥0 → 最大余数法取整(使格子之和精确等于合计的取整)。
// 边际合计一律由取整后的格子求和派生,因此"子项加总 = 合计"在表内恒成立。
/** 最大余数法:把非负浮点数组四舍五入为整数,且总和 = round(sum) */
export function largestRemainderRound(values) {
    const total = values.reduce((a, b) => a + b, 0);
    const target = Math.round(total);
    const floors = values.map((v) => Math.floor(v));
    let remainder = target - floors.reduce((a, b) => a + b, 0);
    // 余数从大到小分配 +1;并列时按下标,保证确定性
    const idx = values
        .map((v, i) => ({ i, frac: v - Math.floor(v) }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
    const out = [...floors];
    for (let k = 0; k < idx.length && remainder > 0; k++, remainder--) {
        out[idx[k].i] += 1;
    }
    // 理论上 remainder 不会 < 0(总和取整与逐项下取整之差 ∈ [0, n)),防御性处理
    for (let k = idx.length - 1; k >= 0 && remainder < 0; k--, remainder++) {
        if (out[idx[k].i] > 0)
            out[idx[k].i] -= 1;
    }
    return out;
}
export function clampNonNegative(values) {
    return values.map((v) => (v > 0 ? v : 0));
}
