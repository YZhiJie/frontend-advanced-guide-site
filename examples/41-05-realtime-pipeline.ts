// 文件: examples/41-05-realtime-pipeline.ts
// ============ 实时数据管道：竞态防护 + 数值插值 ============
// 大屏的实时刷新有两个经典坑：
// 1) 竞态：轮询/WS 推送乱序，慢的旧响应覆盖快的新数据 → 用数据版本号（单调递增）拒绝旧包；
// 2) 数字跳变：指标从 327 直接跳到 891，观感差且用户看不出趋势 → 用 tween 插值让数字平滑滚动。
// 管道：数据到达 → 版本校验 → 归一化 → 插值动画 → 渲染。
// 本示例全部纯逻辑模拟，可重复运行。

export interface MetricPayload {
  value: number;
  /** 数据版本：服务端时间戳或单调序号 */
  version: number;
}

/** 版本守卫：只接受更新的数据（防旧响应晚到覆盖新数据） */
export class VersionGuard {
  private latestVersion = -Infinity;

  accept(p: MetricPayload): boolean {
    if (p.version <= this.latestVersion) return false; // 旧包丢弃
    this.latestVersion = p.version;
    return true;
  }
}

/**
 * 数值插值（tween）：当前显示值 → 目标值，按缓动函数分帧推进。
 * 大屏常用 easeOutCubic：先快后慢，收敛感强。
 */
export function tweenFrame(
  from: number,
  to: number,
  elapsedRatio: number,
): number {
  const t = Math.min(1, Math.max(0, elapsedRatio));
  const eased = 1 - Math.pow(1 - t, 3);
  return from + (to - from) * eased;
}

/** 完整管道：到达 → 版本校验 → 产出插值帧序列 */
export function pipeline(
  guard: VersionGuard,
  payload: MetricPayload,
  displayed: number,
): { accepted: boolean; frames: number[] } {
  if (!guard.accept(payload)) return { accepted: false, frames: [] };
  // 生成 10 帧插值序列（模拟 10 个 rAF）
  const frames: number[] = [];
  for (let i = 1; i <= 10; i++) {
    frames.push(
      Number(tweenFrame(displayed, payload.value, i / 10).toFixed(1)),
    );
  }
  return { accepted: true, frames };
}

// ---------------- 验证 ----------------

console.log("=== 版本守卫：旧包拒收 ===");
const guard = new VersionGuard();
console.log(
  "v100 到达:",
  pipeline(guard, { value: 327, version: 100 }, 0).accepted,
);
console.log(
  "v98 晚到（旧包）:",
  pipeline(guard, { value: 200, version: 98 }, 327).accepted,
);
console.log(
  "v101 到达:",
  pipeline(guard, { value: 891, version: 101 }, 327).accepted,
);

console.log("\n=== 数值插值：327 → 891 平滑滚动（10 帧） ===");
const { frames } = pipeline(
  new VersionGuard(),
  { value: 891, version: 101 },
  327,
);
console.log(frames.join(" → "));
console.log("首帧快、尾帧慢（easeOutCubic 收敛感）");

console.log("\n=== 对比：无插值的硬跳 ===");
console.log("327 → 891（用户：数据是不是错了？）");

console.log("\n=== 管道全貌（示意） ===");
console.log(`
// WS/轮询 → VersionGuard.accept? → normalize → tween(onFrame=渲染)
// 轮询场景再加两层：可见性暂停（document.hidden 不请求）+ 失败退避`);
