// 文件: examples/77-04-blank-screen-guard.ts
// ============ 白屏守卫：多信号检测 + 一次性恢复 + 兜底降级 ============
// 把 77.4 的白屏治理落成状态机：只有「关键内容缺失 + 超时/错误信号」同时成立才判定白屏，
// 恢复动作严格分级（重试 chunk → 刷新一次 → 兜底页），并用会话标记防止刷新死循环。
// 设计决策：
// - 骨架屏与合法空态必须先排除，否则会把「正常加载中」误报成白屏；
// - 刷新只允许一次（sessionStorage 标记），第二次必须落到兜底页并上报；
// - 所有判定返回结构化结果，监控与 UI 都消费同一份事实，避免两处口径漂移。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 观测信号：页面加载后约 5 秒采集 ----------------

interface Signals {
  /** 首次内容绘制耗时；undefined 表示始终没有绘制 */
  fcpMs?: number;
  /** 根容器子节点数；0 表示 DOM 完全没起来 */
  rootChildCount: number;
  /** 业务关键节点（如列表/表单容器）是否存在 */
  keyNodePresent: boolean;
  /** 是否捕获到未处理错误 */
  runtimeError: boolean;
  /** 是否有 chunk / 资源加载失败 */
  chunkError: boolean;
  /** 骨架屏是否可见（合法加载中） */
  skeletonVisible: boolean;
  /** 该页面是否允许合法空态（如「暂无数据」） */
  allowEmptyState: boolean;
  /** 本会话是否已经自动刷新过 */
  reloadedThisSession: boolean;
  /** 本会话 chunk 重试次数 */
  chunkRetryCount: number;
}

type Action = "healthy" | "retry-chunk" | "reload-once" | "fallback" | "report-only";

interface Verdict {
  blank: boolean;
  severity: "none" | "suspect" | "confirmed";
  action: Action;
  reason: string;
}

/** 判定超时：5 秒仍无关键内容，视为疑似白屏（4G 下 95 分位页面也能完成首屏） */
const FCP_TIMEOUT_MS = 5000;
/** 最多允许自动刷新 1 次；chunk 重试 1 次 */
const MAX_RELOAD = 1;
const MAX_CHUNK_RETRY = 1;

function evaluate(signals: Signals): Verdict {
  // ① 先排除误报：骨架屏在显示、或页面本身允许空态，都不算白屏
  if (signals.skeletonVisible) {
    return { blank: false, severity: "none", action: "healthy", reason: "骨架屏可见，属于正常加载中" };
  }
  if (signals.allowEmptyState) {
    return { blank: false, severity: "none", action: "healthy", reason: "页面允许空态，无内容不代表故障" };
  }

  // ② 确认白屏的硬条件：没有绘制，或关键节点缺失
  const noPaint = signals.fcpMs === undefined || signals.fcpMs > FCP_TIMEOUT_MS;
  const noContent = signals.rootChildCount === 0 || !signals.keyNodePresent;
  // 关键内容缺失，且同时存在「没绘制 / 已绘制但渲染崩溃」的硬信号，才算确认白屏
  const confirmed = noContent && (noPaint || signals.runtimeError);

  // ③ 恢复动作分三级，顺序不可颠倒
  if (signals.chunkError && signals.chunkRetryCount < MAX_CHUNK_RETRY) {
    return {
      blank: confirmed,
      severity: confirmed ? "confirmed" : "suspect",
      action: "retry-chunk",
      reason: "资源加载失败优先重试 chunk，成本最低且不丢用户状态",
    };
  }
  if (confirmed && signals.runtimeError) {
    // 渲染期崩溃刷新也救不回来，直接兜底，避免用户看第二次白屏
    return { blank: true, severity: "confirmed", action: "fallback", reason: "运行时错误导致渲染中断，应展示兜底页" };
  }
  if (confirmed) {
    if (!signals.reloadedThisSession && MAX_RELOAD === 1) {
      return { blank: true, severity: "confirmed", action: "reload-once", reason: "疑似版本/缓存不一致，允许一次自动刷新" };
    }
    return { blank: true, severity: "confirmed", action: "fallback", reason: "已自动刷新过仍白屏，禁止再次刷新，降级兜底" };
  }
  if (noPaint || noContent) {
    return { blank: false, severity: "suspect", action: "report-only", reason: "存在异常信号但未同时满足白屏条件，只上报不打扰用户" };
  }
  return { blank: false, severity: "none", action: "healthy", reason: "关键内容已呈现" };
}

// ---------------- 2. 典型场景回归 ----------------

const SCENARIOS: Array<{ name: string; signals: Signals; expect: Action }> = [
  {
    name: "正常首屏",
    signals: { fcpMs: 1200, rootChildCount: 12, keyNodePresent: true, runtimeError: false, chunkError: false, skeletonVisible: false, allowEmptyState: false, reloadedThisSession: false, chunkRetryCount: 0 },
    expect: "healthy",
  },
  {
    name: "骨架屏加载中",
    signals: { fcpMs: 1800, rootChildCount: 6, keyNodePresent: false, runtimeError: false, chunkError: false, skeletonVisible: true, allowEmptyState: false, reloadedThisSession: false, chunkRetryCount: 0 },
    expect: "healthy",
  },
  {
    name: "chunk 404 首次",
    signals: { fcpMs: undefined, rootChildCount: 0, keyNodePresent: false, runtimeError: false, chunkError: true, skeletonVisible: false, allowEmptyState: false, reloadedThisSession: false, chunkRetryCount: 0 },
    expect: "retry-chunk",
  },
  {
    name: "渲染崩溃",
    signals: { fcpMs: 200, rootChildCount: 0, keyNodePresent: false, runtimeError: true, chunkError: false, skeletonVisible: false, allowEmptyState: false, reloadedThisSession: false, chunkRetryCount: 0 },
    expect: "fallback",
  },
  {
    name: "慢网络首次白屏",
    signals: { fcpMs: 9000, rootChildCount: 0, keyNodePresent: false, runtimeError: false, chunkError: false, skeletonVisible: false, allowEmptyState: false, reloadedThisSession: false, chunkRetryCount: 0 },
    expect: "reload-once",
  },
  {
    name: "刷新后仍白屏",
    signals: { fcpMs: 9000, rootChildCount: 0, keyNodePresent: false, runtimeError: false, chunkError: false, skeletonVisible: false, allowEmptyState: false, reloadedThisSession: true, chunkRetryCount: 0 },
    expect: "fallback",
  },
  {
    name: "关键节点缺失但已绘制",
    signals: { fcpMs: 800, rootChildCount: 30, keyNodePresent: false, runtimeError: false, chunkError: false, skeletonVisible: false, allowEmptyState: false, reloadedThisSession: false, chunkRetryCount: 0 },
    expect: "report-only",
  },
];

console.log("=== 白屏守卫决策 ===");
console.table(
  SCENARIOS.map((s) => {
    const v = evaluate(s.signals);
    return { 场景: s.name, 动作: v.action, 级别: v.severity, 原因: v.reason };
  }),
);

// ---------------- 3. 硬断言 ----------------

for (const s of SCENARIOS) {
  assert(evaluate(s.signals).action === s.expect, `场景「${s.name}」应决策为 ${s.expect}`);
}

// 骨架屏与空态绝不能误判
assert(!evaluate(SCENARIOS[1].signals).blank, "骨架屏可见不能判白屏");
assert(!evaluate({ ...SCENARIOS[0].signals, keyNodePresent: false, allowEmptyState: true }).blank, "合法空态不能判白屏");

// chunk 重试后仍失败，应升级为刷新而不是无限重试
assert(evaluate({ ...SCENARIOS[2].signals, chunkRetryCount: 1 }).action === "reload-once", "chunk 重试耗尽后应升级为刷新");

// 刷新后仍白屏必须降级，不能刷新第二次
const afterReload = evaluate(SCENARIOS[5].signals);
assert(afterReload.action === "fallback" && afterReload.blank, "二次白屏必须兜底，禁止刷新死循环");

// 仅「没绘制」或仅「没内容」都只是疑似，不应打扰用户
assert(evaluate({ ...SCENARIOS[0].signals, fcpMs: undefined }).action === "report-only", "仅无绘制只能上报，不能刷新用户页面");

console.log("\n✅ 白屏守卫示例全部断言通过");
