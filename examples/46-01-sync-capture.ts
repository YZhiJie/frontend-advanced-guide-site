// 文件: examples/46-01-sync-capture.ts
// ============ 同步错误捕获:try/catch 能抓什么、抓不到什么 ============
// 设计要点:
// 1) try/catch 只能捕获「同一事件循环回合内、同步抛出」的异常;
// 2) setTimeout/事件回调里的 throw 与外层 try/catch 已经不在同一个调用栈,永远抓不到;
// 3) Promise executor 里的同步 throw 是唯一特例——会被 Promise 构造函数转成 rejection;
// 4) 错误包装用 Error 的 cause 保留原始错误,日志里能看到完整因果链。

/** 硬断言:不满足即非零退出,让 CI 门禁能真的拦截 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---- 1. 同步抛错:try/catch 的基本盘 ----
function parsePrice(raw: string): number {
  const data = JSON.parse(raw) as { price?: number }; // JSON.parse 是同步抛错的典型代表
  if (typeof data.price !== "number") {
    throw new TypeError(`price 必须是 number,收到 ${typeof data.price}`);
  }
  return data.price;
}

try {
  parsePrice('{"price": "abc"}');
} catch (e) {
  console.log(
    "✓ 1. 同步错误被捕获:",
    (e as Error).name,
    "-",
    (e as Error).message,
  );
}

// ---- 2. 盲区:setTimeout 回调里的 throw,外层 try/catch 抓不到 ----
let caughtByOuter = false;
const errors: string[] = [];
// 用自建的「微型事件队列」模拟浏览器事件循环:回调在另一个回合才被调用
const macrotaskQueue: Array<() => void> = [];
function fakeSetTimeout(cb: () => void) {
  macrotaskQueue.push(cb);
}
function drainQueue() {
  for (const cb of macrotaskQueue.splice(0)) {
    try {
      cb();
    } catch (e) {
      // 真实浏览器里这个 catch 等价于 window.onerror —— 回调有自己的调用栈
      errors.push((e as Error).message);
    }
  }
}

try {
  fakeSetTimeout(() => {
    throw new Error("延迟爆炸");
  });
} catch {
  caughtByOuter = true; // ❌ 永远到不了这里
}
drainQueue();
console.log(
  "✓ 2. 外层 try/catch 抓到?",
  caughtByOuter,
  "| 全局兜底抓到:",
  errors,
);
assert(
  caughtByOuter === false && errors.length === 1,
  "异步回调错误必须靠全局兜底",
);

// ---- 3. 特例:Promise executor 的同步 throw 自动转 rejection ----
const p = new Promise(() => {
  throw new Error("executor 同步抛错");
});
await p.catch((e) =>
  console.log("✓ 3. executor 抛错转成 rejection:", e.message),
);

// ---- 4. 错误包装:cause 保留因果链,不丢原始现场 ----
class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ConfigError";
  }
}

function loadConfig(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    // ✅ 包装成业务错误,但用 cause 挂上原始 SyntaxError,两层信息都在
    throw new ConfigError("配置文件解析失败", { cause: e });
  }
}

try {
  loadConfig("{bad json");
} catch (e) {
  const err = e as ConfigError;
  console.log("✓ 4. 包装层:", err.name, "-", err.message);
  console.log("     原始层:", (err.cause as Error).name);
  assert(err.cause instanceof SyntaxError, "cause 必须保留原始错误");
}

// ---- 5. finally:不管成不成都要收尾(关闭连接、停 loading、还锁) ----
let loading = true;
try {
  parsePrice('{"price": 9.9}');
} finally {
  loading = false; // ✅ finally 在 return/throw 之前也会执行
}
console.log("✓ 5. finally 收尾后 loading =", loading);
assert(loading === false, "finally 必须执行");

console.log("\n全部断言通过:同步捕获边界已厘清");
