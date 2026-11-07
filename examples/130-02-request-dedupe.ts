// 文件: examples/130-02-request-dedupe.ts
// 130.3 请求层三件套：在途去重、竞态守卫、超时与重试
// 这些能力 axios/ky/TanStack Query 都有，但必须理解边界，否则会「库在重试，你也在重试」。
import assert from "node:assert/strict";

type Fetcher<T> = (signal: AbortSignal) => Promise<T>;

/** 在途去重：同 key 的并发请求共享同一个 Promise，结束后立即清理 */
export class InFlightDeduper {
  private map = new Map<string, { promise: Promise<unknown>; controller: AbortController; refs: number }>();

  run<T>(key: string, fetcher: Fetcher<T>): Promise<T> {
    const existing = this.map.get(key);
    if (existing) {
      existing.refs++;
      return existing.promise as Promise<T>;
    }
    const controller = new AbortController();
    const promise = fetcher(controller.signal).finally(() => {
      // 只有仍是当前条目时才删除，避免旧请求清掉新请求
      if (this.map.get(key)?.promise === promise) this.map.delete(key);
    });
    this.map.set(key, { promise, controller, refs: 1 });
    return promise;
  }

  /** 主动取消：所有调用方都会收到 AbortError，适合路由离开/搜索词变化 */
  abort(key: string): void {
    const entry = this.map.get(key);
    if (!entry) return;
    entry.controller.abort();
    this.map.delete(key);
  }

  size(): number {
    return this.map.size;
  }
}

/** 竞态守卫：只接受最新一次请求的结果，旧响应直接丢弃 */
export class LatestGuard {
  private seq = 0;
  issue(): number {
    return ++this.seq;
  }
  isLatest(token: number): boolean {
    return token === this.seq;
  }
}

/** 超时：把 AbortSignal 与计时器组合；注意清理定时器，避免长驻 */
export async function withTimeout<T>(task: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${ms}ms`)), ms);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** 指数退避 + 抖动；只对可重试错误重试 */
export async function retry<T>(
  task: () => Promise<T>,
  options: { retries?: number; baseMs?: number; shouldRetry?: (e: unknown) => boolean; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const baseMs = options.baseMs ?? 100;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (e) {
      lastError = e;
      if (attempt === retries || (options.shouldRetry && !options.shouldRetry(e))) throw e;
      const backoff = baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs);
      await sleep(backoff);
    }
  }
  throw lastError;
}

// ---------------- 断言 ----------------
const deduper = new InFlightDeduper();
let calls = 0;
let release!: (v: string) => void;
const gate = new Promise<string>((r) => { release = r; });
const fetcher: Fetcher<string> = async () => { calls++; return gate; };

const p1 = deduper.run("user:1", fetcher);
const p2 = deduper.run("user:1", fetcher);
assert.equal(p1, p2, "同 key 并发共享 Promise");
assert.equal(calls, 1);
assert.equal(deduper.size(), 1);
release("ok");
assert.deepEqual(await Promise.all([p1, p2]), ["ok", "ok"]);
await Promise.resolve();
assert.equal(deduper.size(), 0, "完成后清理");

// 取消
let aborted = false;
const p3 = deduper.run("search:react", (signal) =>
  new Promise<string>((resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
    setTimeout(() => resolve("late"), 50);
  }),
);
deduper.abort("search:react");
await assert.rejects(p3, /aborted/);
assert.equal(aborted, true);

// 竞态守卫：旧结果丢弃
const guard = new LatestGuard();
const t1 = guard.issue();
const t2 = guard.issue();
assert.equal(guard.isLatest(t1), false);
assert.equal(guard.isLatest(t2), true);

// 超时
await assert.rejects(
  withTimeout((signal) => new Promise<string>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
    setTimeout(() => resolve("too late"), 100);
  }), 10),
  /timeout/,
);

// 重试：前两次失败，第三次成功
let attempts = 0;
const value = await retry(async () => {
  attempts++;
  if (attempts < 3) throw new Error("flaky");
  return "done";
}, { retries: 3, baseMs: 1, sleep: async () => {} });
assert.equal(value, "done");
assert.equal(attempts, 3);

// 不可重试错误立即抛出
let fatalAttempts = 0;
await assert.rejects(
  retry(async () => { fatalAttempts++; throw Object.assign(new Error("400"), { status: 400 }); }, {
    retries: 3,
    sleep: async () => {},
    shouldRetry: (e) => (e as { status?: number }).status !== 400,
  }),
  /400/,
);
assert.equal(fatalAttempts, 1, "4xx 不应重试");

console.log("✓ 130-02 去重、取消、竞态、超时与重试断言全部通过");
