// 文件: examples/25-02-observer-contract.ts —— [模拟] IntersectionObserver 回调契约
// ============ 浏览器 API 在 Node 里跑不了,但「回调契约」可以用模拟驱动讲透============
export {}; // 顶层 await 需要 ESM 模块语义
// 真实 API: new IntersectionObserver(cb, { threshold, rootMargin }) + observe/unobserve
// 本示例按 MDN 契约复刻其调度行为,验证三个最常被误解的点:
//   1. observe() 后【必然立即回调一次】,哪怕元素根本不可见
//   2. threshold 是「交叉比例跨越阈值」才触发,不是「每帧都报」
//   3. unobserve/isIntersecting 语义——曝光埋点必须判断 isIntersecting

interface MockEntry {
  target: string;
  isIntersecting: boolean;
  intersectionRatio: number;
}

class MockIntersectionObserver {
  private targets = new Map<string, number>(); // 元素名 → 当前交叉比例
  private thresholds: number[];
  // 不用 TS 参数属性语法(private cb: ...)——node 原生 strip-types 不支持,保持双运行器可跑
  private cb: (entries: MockEntry[]) => void;
  constructor(
    cb: (entries: MockEntry[]) => void,
    options: { threshold?: number[] } = {},
  ) {
    this.cb = cb;
    // 规范:threshold 缺省为 [0];浏览器会把 1.0 修正为略小于 1(浮点陷阱,见正文)
    this.thresholds = options.threshold ?? [0];
  }
  observe(target: string, ratio = 0) {
    this.targets.set(target, ratio);
    // 契约 1:observe 后立即回调一次(异步微任务时机),不管可见与否
    queueMicrotask(() => this.report());
  }
  unobserve(target: string) {
    this.targets.delete(target);
  }
  // 模拟页面滚动:更新交叉比例,只有「跨越阈值档位」才产生通知
  scroll(target: string, ratio: number) {
    if (!this.targets.has(target)) return;
    const prev = this.targets.get(target)!;
    this.targets.set(target, ratio);
    const band = (r: number) =>
      this.thresholds.findIndex((t) => (t === 0 ? r > 0 : r >= t));
    if (band(prev) !== band(ratio)) this.report();
  }
  private report() {
    const entries: MockEntry[] = [];
    for (const [target, ratio] of this.targets) {
      entries.push({
        target,
        isIntersecting: ratio > 0,
        intersectionRatio: ratio,
      });
    }
    this.cb(entries);
  }
}

// ── 演示一:observe 即回调,首次 isIntersecting 可能是 false ──
const io = new MockIntersectionObserver((entries) => {
  for (const e of entries) {
    console.log(
      `  回调: ${e.target} 可见=${e.isIntersecting} 比例=${e.intersectionRatio}`,
    );
  }
});
console.log("演示一:observe() 立即回调一次(元素尚在视口外)");
io.observe("footer", 0); // 页脚,当前不可见
await new Promise((r) => setTimeout(r, 5));
// → 埋点若不判断 isIntersecting,首帧就会误报一次曝光

// ── 演示二:threshold 跨越才触发 ──
console.log("演示二:threshold=[0.5],比例 0.4→0.6 触发,0.6→0.7 不触发");
const io2 = new MockIntersectionObserver(
  (entries) =>
    console.log(
      `  回调: ${entries[0].target} 比例=${entries[0].intersectionRatio}`,
    ),
  { threshold: [0.5] },
);
io2.observe("card", 0.4);
await new Promise((r) => setTimeout(r, 5));
io2.scroll("card", 0.6); // 跨过 0.5 → 触发
io2.scroll("card", 0.7); // 同档位 → 静默
io2.scroll("card", 0.2); // 跌破 → 触发(离开视口也要通知,用于取消加载)

// ── 演示三:unobserve 后彻底静默(一次性曝光埋点的标准写法) ──
console.log("演示三:unobserve 后滚动不再产生回调");
io2.unobserve("card");
io2.scroll("card", 0.9); // 无输出
console.log("完成(无更多输出即符合契约)");
