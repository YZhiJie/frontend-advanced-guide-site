// 文件: examples/25-07-task-ordering.ts —— 微任务与宏任务的执行顺序
// ============ queueMicrotask / Promise / setTimeout 的调度差异,Node 18+ 原生可跑============
export {}; // 顶层 await 需要 ESM 模块语义

const order: string[] = [];

console.log(
  "入队顺序:同步代码 → queueMicrotask → Promise.then → setTimeout(0)",
);
order.push("① 同步");
queueMicrotask(() => order.push("③ queueMicrotask"));
Promise.resolve().then(() => order.push("④ Promise.then"));
setTimeout(() => order.push("⑤ setTimeout(0)"), 0);
order.push("② 同步末尾");
// 事件循环规则:当前同步代码跑完 → 清空整个微任务队列 → 才进入下一轮宏任务
await new Promise((r) => setTimeout(r, 10));
console.log("实际执行顺序:", order.join(" → "));

// ── 为什么「微任务里再发微任务」不会饿死宏任务?规范保证「清空到不能再清」 ──
const chain: string[] = [];
queueMicrotask(() => {
  chain.push("微任务1");
  queueMicrotask(() => chain.push("微任务1.1(同一轮清空里继续执行)"));
});
queueMicrotask(() => chain.push("微任务2"));
setTimeout(() => {
  // 走到这里说明微任务队列已彻底清空,宏任务才有机会
  console.log("链式微任务全部先于 setTimeout:", chain.join(" / "));
}, 0);
await new Promise((r) => setTimeout(r, 10));

// ── 实战:queueMicrotask 的正确用途 = "异步化"一个本该同步的回调 ──
// 典型:发布订阅里避免「订阅者抛错打断发布者」+ 保证状态一致后再通知
class Signal<T> {
  private subs = new Set<(v: T) => void>();
  subscribe(fn: (v: T) => void) {
    this.subs.add(fn);
  }
  set(v: T) {
    // 若同步遍历调用,某个订阅者抛错会中断后面的订阅者,且本轮状态变更被截断
    for (const fn of this.subs) {
      queueMicrotask(() => {
        try {
          fn(v);
        } catch (e) {
          console.log("  订阅者异常已隔离:", (e as Error).message);
        }
      });
    }
  }
}
console.log("\nSignal 通知(微任务隔离异常):");
const sig = new Signal<number>();
sig.subscribe((v) => console.log("  订阅者A:", v));
sig.subscribe(() => {
  throw new Error("B 崩了");
});
sig.subscribe((v) => console.log("  订阅者C:", v));
sig.set(42);
await new Promise((r) => setTimeout(r, 10));
// A/C 正常收到,B 的异常被隔离——同步调用则 C 永远收不到

// 浏览器对照速记:
//   微任务:queueMicrotask / Promise.then / MutationObserver
//   宏任务:setTimeout / setInterval / 消息与 IO 事件
//   帧调度:requestAnimationFrame(渲染前)/ requestIdleCallback(空闲时)——Node 无后两者
