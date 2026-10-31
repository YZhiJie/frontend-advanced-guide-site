// 文件: examples/45-01-debug-toolkit.ts
// ============ 调试工具箱：把 console.log 变成可检索的证据链 ============
// 目标：业务代码只依赖一个 createDebug(scope)，统一收口日志、计时、断言与快照。
// 关键点：
//   1. console.log 打印对象是「活引用」，展开时可能已被改得面目全非 -> snapshot 深拷贝；
//   2. 日志要带 scope 与级别，线上才能按模块检索；
//   3. 只保留最近 N 条（环形缓冲），避免一个循环把内存打爆；
//   4. 计时超过预算自动升级为 warn，把性能问题暴露在开发期。
// 运行：npx tsx examples/45-01-debug-toolkit.ts

type Level = "debug" | "info" | "warn" | "error";

interface LogEntry {
  at: number;
  level: Level;
  scope: string;
  msg: string;
  data?: unknown;
}

const MAX_ENTRIES = 200;

function createDebug(scope: string) {
  const entries: LogEntry[] = [];

  const record = (level: Level, msg: string, data?: unknown): void => {
    entries.push({ at: Date.now(), level, scope, msg, data });
    if (entries.length > MAX_ENTRIES) entries.shift();
    const out =
      level === "debug" || level === "info" ? console.log : console[level];
    if (data === undefined) out(`[${scope}] ${msg}`);
    else out(`[${scope}] ${msg}`, data);
  };

  return {
    debug: (msg: string, data?: unknown) => record("debug", msg, data),
    info: (msg: string, data?: unknown) => record("info", msg, data),
    warn: (msg: string, data?: unknown) => record("warn", msg, data),
    error: (msg: string, data?: unknown) => record("error", msg, data),

    /**
     * 计时：异常也要先记录再抛出，finally 保证耗时一定落账。
     * budgetMs 默认 16ms（一帧），超过则升级为 warn。
     */
    time<T>(label: string, fn: () => T, budgetMs = 16): T {
      const t0 = performance.now();
      try {
        return fn();
      } catch (error) {
        record("error", `${label} 执行失败`, error);
        throw error;
      } finally {
        const ms = performance.now() - t0;
        record(
          ms > budgetMs ? "warn" : "debug",
          `${label} 耗时 ${ms.toFixed(2)}ms${ms > budgetMs ? `（超预算 ${budgetMs}ms）` : ""}`,
        );
      }
    },

    /** 深拷贝快照：打印/上报都该用它，避免活引用在控制台展开时变样 */
    snapshot<T>(value: T): T {
      return structuredClone(value);
    },

    /** 断言失败立即抛错，避免错误状态继续往下流 */
    assert(condition: unknown, message: string): void {
      if (!condition) {
        record("error", `断言失败：${message}`);
        throw new Error(message);
      }
    },

    /** 结构化表格：数组对象用 console.table 比一行行 log 好读得多 */
    table(rows: readonly Record<string, unknown>[]): void {
      console.table(rows);
    },

    /** 取最近 N 条；线上可把 buffer 一次性上报，而不是逐条打点 */
    last(count = 10, level?: Level): LogEntry[] {
      const pool = level ? entries.filter((e) => e.level === level) : entries;
      return pool.slice(-count);
    },
  };
}

// ============ 演示：一个购物车模块的排障过程 ============

interface Cart {
  items: Array<{ sku: string; qty: number }>;
}

const dbg = createDebug("cart");
const cart: Cart = { items: [{ sku: "A-1", qty: 1 }] };

// 1) 活引用 vs 快照：这是 console.log 最常见的误判来源
const live = cart;
const frozen = dbg.snapshot(cart);
cart.items[0].qty = 99;
dbg.info("同一份数据，打印时刻不同", {
  liveQty: live.items[0].qty,
  frozenQty: frozen.items[0].qty,
});

// 2) 计时：循环里的同步重活应该被看见
const total = dbg.time("计算 10 万次累加", () => {
  let sum = 0;
  for (let i = 0; i < 100_000; i++) sum += i;
  return sum;
});
dbg.debug("累加结果", total);

// 3) 断言：失败路径必须抛出，不能只打印一行红字继续跑
try {
  dbg.assert(cart.items.length === 2, "购物车应有两件商品");
} catch (error) {
  dbg.warn("断言按预期拦住错误状态", (error as Error).message);
}

// 4) 表格：批量数据一眼对齐
dbg.table(
  cart.items.map((item) => ({
    SKU: item.sku,
    数量: item.qty,
    小计: item.qty * 19.9,
  })),
);

// 5) 环形缓冲：高频日志只留最近 200 条
for (let i = 0; i < 5; i++) dbg.debug(`轮询第 ${i + 1} 次`);
dbg.info(
  "最近 2 条调试日志",
  dbg.last(2, "debug").map((e) => e.msg),
);

// 6) 汇总校验：演示中唯一允许的 error 是被主动捕获的断言
const unexpected = dbg
  .last(MAX_ENTRIES, "error")
  .filter((e) => !e.msg.startsWith("断言失败"));
if (unexpected.length > 0)
  throw new Error(`演示失败：${unexpected.map((e) => e.msg).join("; ")}`);

console.log("\n✓ 调试工具箱演示通过：快照、计时、断言、表格与环形缓冲均正常");

export {};
