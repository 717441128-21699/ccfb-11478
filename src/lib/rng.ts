// 确定性随机数生成器（mulberry32 / splitmix32）+ 差分隐私采样原语
// 浏览器默认使用 crypto.getRandomValues 播种；脚本侧可传入固定种子复现结果

export class Rng {
  private state: number;

  constructor(seed?: number) {
    if (seed === undefined) {
      const buf = new Uint32Array(1);
      globalThis.crypto.getRandomValues(buf);
      seed = buf[0];
    }
    // 避免全零状态
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** [0, 1) 均匀分布，mulberry32 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 标准正态分布（Box-Muller） */
  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /** 标准拉普拉斯分布：-scale*sgn(u-0.5)*ln(1-2|u-0.5|)，scale=1 */
  laplace(): number {
    let u = this.next();
    while (u === 0.5) u = this.next();
    return -Math.sign(u - 0.5) * Math.log(1 - 2 * Math.abs(u - 0.5));
  }
}
