// 随机数:可复现的种子 PRNG(用于合成数据与验证脚本),
// 以及基于 crypto 的安全随机源(用于真实发布加噪)。
/** mulberry32 种子 PRNG,确定性可复现 */
export function seededRng(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** 浏览器/Node 的密码学随机源,真实发布必须使用它 */
export function cryptoRng() {
    const buf = new Uint32Array(1);
    return () => {
        globalThis.crypto.getRandomValues(buf);
        // 避免恰好为 0(log 发散)
        return (buf[0] + 1) / 4294967297;
    };
}
export class Sampler {
    uniform;
    constructor(uniform) {
        this.uniform = uniform;
    }
    /** (0,1) 均匀随机数 */
    next() {
        return this.uniform();
    }
    /** 标准正态(Box-Muller) */
    standardNormal() {
        let u = 0;
        while (u <= 1e-12)
            u = this.uniform();
        const v = this.uniform();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    gaussian(sigma) {
        return sigma * this.standardNormal();
    }
    /** 拉普拉斯(逆变换采样),scale = b */
    laplace(scale) {
        const u = this.uniform() - 0.5;
        return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    }
}
