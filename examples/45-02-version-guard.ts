// 文件: examples/45-02-version-guard.ts
// ============ 版本守卫：发版后旧页面如何安全地“自我更新” ============
// 三个独立问题，别混成一个：
//   1) 页面一直开着，服务端已经发了新版本 -> 轮询 version.json，提示用户刷新；
//   2) 路由懒加载的 chunk 已被新版本覆盖 -> 动态 import 失败，自动刷新一次；
//   3) 刷新保护：绝不能在冷却期内重复刷新，否则弱网或坏版本会陷入刷新死循环。
// 运行：npx tsx examples/45-02-version-guard.ts

interface VersionInfo {
  buildId: string;
  version: string;
  releasedAt: string;
}

/** 各构建器/浏览器的 chunk 加载失败文案并不统一，必须一起匹配 */
const CHUNK_ERROR =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

function isChunkLoadError(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return CHUNK_ERROR.test(text);
}

/** 只比较数字段；预发布/构建号请用 buildId 而不是 semver */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

interface GuardOptions {
  /** 两次版本查询的最小间隔 */
  intervalMs?: number;
  /** 两次自动刷新的最小间隔，防止死循环 */
  cooldownMs?: number;
  /** 可注入时钟，测试不依赖真实时间 */
  now?: () => number;
}

type CheckResult = "same" | "update" | "throttled" | "error";

class UpdateGuard {
  private readonly intervalMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private lastCheckAt = Number.NEGATIVE_INFINITY;
  private lastReloadAt = Number.NEGATIVE_INFINITY;
  private checking = false;

  constructor(options: GuardOptions = {}) {
    this.intervalMs = options.intervalMs ?? 5 * 60_000;
    this.cooldownMs = options.cooldownMs ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /**
   * 轮询入口：可见性变化/定时器都调这里。
   * 返回 update 时只负责“提示”，不要在这里直接 reload——用户可能正在填表单。
   */
  async check(
    current: VersionInfo,
    fetcher: () => Promise<VersionInfo>,
  ): Promise<CheckResult> {
    if (this.checking) return "throttled";
    const now = this.now();
    if (now - this.lastCheckAt < this.intervalMs) return "throttled";
    this.lastCheckAt = now;
    this.checking = true;
    try {
      const next = await fetcher();
      if (next.buildId !== current.buildId) return "update";
      // buildId 相同但版本号回退，说明用户命中了旧 CDN，仍按更新处理
      if (compareSemver(next.version, current.version) < 0) return "update";
      return "same";
    } catch {
      return "error";
    } finally {
      this.checking = false;
    }
  }

  /** chunk 加载失败时调用：true 表示可以刷新，false 表示冷却中，交给错误兜底 */
  canReloadOnChunkError(error: unknown, now = this.now()): boolean {
    if (!isChunkLoadError(error)) return false;
    if (now - this.lastReloadAt < this.cooldownMs) return false;
    this.lastReloadAt = now;
    return true;
  }
}

// ============ 演示：注入假时钟，验证节流、更新判断与刷新保护 ============

async function main(): Promise<void> {
  let clock = 1_000_000;
  const guard = new UpdateGuard({
    intervalMs: 60_000,
    cooldownMs: 10_000,
    now: () => clock,
  });

  const current: VersionInfo = {
    buildId: "b-2026-10-22-a",
    version: "1.72.0",
    releasedAt: "2026-10-22T08:00:00Z",
  };
  const next: VersionInfo = {
    buildId: "b-2026-10-22-b",
    version: "1.72.1",
    releasedAt: "2026-10-22T09:00:00Z",
  };

  const fetcher = async () => next;

  // 1) 第一次查询：发现新版本
  const first = await guard.check(current, fetcher);
  if (first !== "update") throw new Error(`期望 update，实际 ${first}`);

  // 2) 60 秒内再次查询：被节流，不打服务端
  clock += 30_000;
  const throttled = await guard.check(current, fetcher);
  if (throttled !== "throttled")
    throw new Error(`期望 throttled，实际 ${throttled}`);

  // 3) 超过间隔：重新允许查询；已经是最新版本则返回 same
  clock += 31_000;
  const again = await guard.check(next, async () => next);
  if (again !== "same") throw new Error(`期望 same，实际 ${again}`);

  // 4) chunk 失败：只允许刷新一次，冷却期内第二次拒绝
  const chunkError = new Error(
    "Failed to fetch dynamically imported module: /assets/OrderList-a1b2.js",
  );
  if (!guard.canReloadOnChunkError(chunkError))
    throw new Error("首次应允许刷新");
  if (guard.canReloadOnChunkError(chunkError))
    throw new Error("冷却期内应拒绝刷新");

  // 5) 普通业务错误不能被误判成 chunk 失败
  if (guard.canReloadOnChunkError(new Error("余额不足")))
    throw new Error("业务错误不应触发刷新");

  // 6) 不是新版本时不要打扰用户
  clock += 61_000;
  const noUpdate = await guard.check(next, async () => next);
  if (noUpdate !== "same") throw new Error(`期望 same，实际 ${noUpdate}`);

  console.log(
    "\n✓ 版本守卫演示通过：更新检测、轮询节流、chunk 刷新保护均符合预期",
  );
}

main().catch((error) => {
  console.error(error);
  throw error;
});

export {};
