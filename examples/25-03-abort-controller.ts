// 文件: examples/25-03-abort-controller.ts —— AbortController 超时/竞态/级联取消
// ============ AbortSignal 是浏览器与 Node 共通的「取消协议」,Node 18+ 原生可跑============
export {}; // 顶层 await 需要 ESM 模块语义

// ── 场景一:超时取消 —— AbortSignal.timeout(ms) 一行搞定,不 leak 定时器 ──
// 等价于手写 new AbortController() + setTimeout(() => controller.abort(), ms),
// 但 timeout() 的定时器在信号被提前 abort 或任务完成后自动清理,不会把进程挂住
async function fetchWithTimeout(name: string, ms: number, cost: number) {
  try {
    await fakeFetch(name, cost, AbortSignal.timeout(ms));
    console.log(`  ${name}: 成功`);
  } catch (e) {
    console.log(`  ${name}: 失败 → ${(e as Error).name}`); // TimeoutError DOMException
  }
}

// 用 setTimeout 模拟网络请求(避免真实网络,门禁离线可跑)
function fakeFetch(
  name: string,
  cost: number,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(`${name}-data`), cost);
    // 关键:请求与信号挂钩。abort 一旦发生,resolve/reject 都要立刻让位
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer); // 必须清理,否则定时器泄漏(见正文坑点)
        reject(signal.reason); // Node/浏览器均以 abort 的 reason 拒绝
      },
      { once: true }, // once:触发即摘,防止重复监听泄漏
    );
  });
}

console.log("场景一:50ms 超时 vs 200ms 的慢请求");
await fetchWithTimeout("慢接口", 50, 200);

// ── 场景二:竞态取消 —— 搜索框连打,只保留最后一次 ──
let latest: AbortController | null = null;
async function search(keyword: string) {
  latest?.abort(); // 上一条作废:abort 会传播给它的 signal 挂钩的所有任务
  latest = new AbortController();
  const { signal } = latest;
  try {
    const r = await fakeFetch(`搜索「${keyword}」`, 30, signal);
    console.log(`  渲染: ${r}`); // 只有最后一条能活到这里
  } catch {
    console.log(`  丢弃: 「${keyword}」的过期请求`);
  }
}
console.log("场景二:连续两次搜索,先发的那条被 abort");
const p1 = search("react");
await new Promise((r) => setTimeout(r, 10)); // 第一条先跑 10ms,模拟用户还在打字
const p2 = search("react hooks"); // 第二条发起 → 第一条被 abort
await Promise.all([p1, p2]);

// ── 场景三:级联取消 —— 一个 signal 撤销多个任务 + 事件监听用 { signal } 一次清 ──
console.log("场景三:一个 controller 同时取消任务与监听");
const ac = new AbortController();
const fired: string[] = [];
// 同一个 signal 既挂任务,又挂三个事件监听(模拟组件里的 resize/scroll/keydown)
// { signal } 是移除监听的新姿势:abort 发生时浏览器自动摘除,无需逐个 removeEventListener
const bus = new EventTarget(); // 浏览器里即 window/元素,Node 里用 EventTarget 等价演示
for (const name of ["resize", "scroll", "keydown"]) {
  bus.addEventListener(name, () => fired.push(name), { signal: ac.signal });
}
const task = fakeFetch("面板数据", 10_000, ac.signal).catch(() => "已取消");
ac.abort(); // 一行撤销全部:任务立刻拒绝,三个监听随 signal 生命周期自动移除
bus.dispatchEvent(new Event("resize")); // 监听已被移除 → 不应触发
console.log("  任务结果:", await task);
console.log(
  "  abort 后再触发 resize,实际触发名单:",
  fired.length ? fired.join(" / ") : "(无,监听已随 signal 移除)",
);
