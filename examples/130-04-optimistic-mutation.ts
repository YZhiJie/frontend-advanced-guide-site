// 文件: examples/130-04-optimistic-mutation.ts
// 130.5 乐观更新：先改 UI、失败回滚、成功后失效重拉
// 对照 TanStack Query 的 onMutate / onError / onSettled 与 SWR 的 optimisticData。
import assert from "node:assert/strict";

export interface Todo { id: string; title: string; done: boolean }

export interface Snapshot { items: Todo[]; version: number }

export class OptimisticStore {
  private items: Todo[] = [];
  private version = 0;
  private listeners = new Set<(s: Snapshot) => void>();

  constructor(initial: Todo[] = []) {
    this.items = initial;
  }

  snapshot(): Snapshot {
    return { items: this.items.map((t) => ({ ...t })), version: this.version };
  }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.version++;
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  /**
   * 乐观更新：
   * 1) 取消在途查询（真实项目：queryClient.cancelQueries）
   * 2) 拍快照
   * 3) 立即改本地
   * 4) 调接口；失败回滚；无论成败都失效重拉
   */
  async mutateOptimistic(
    updater: (items: Todo[]) => Todo[],
    request: () => Promise<void>,
    hooks: { onSettled?: () => void } = {},
  ): Promise<{ ok: boolean; rolledBack: boolean }> {
    const snapshot = this.snapshot();
    this.items = updater(this.items);
    this.emit();
    try {
      await request();
      return { ok: true, rolledBack: false };
    } catch {
      // ⚠️ 回滚要基于快照，而不是「再反向操作一次」——并发下反向操作会算错
      this.items = snapshot.items;
      this.emit();
      return { ok: false, rolledBack: true };
    } finally {
      hooks.onSettled?.();
    }
  }

  /** 版本守卫：晚到的响应不能覆盖新状态 */
  async mutateWithVersion(
    request: () => Promise<Todo[]>,
  ): Promise<{ applied: boolean; version: number }> {
    const startedAt = this.version;
    const serverItems = await request();
    if (this.version !== startedAt) return { applied: false, version: this.version };
    this.items = serverItems;
    this.emit();
    return { applied: true, version: this.version };
  }
}

// ---------------- 断言 ----------------
const store = new OptimisticStore([{ id: "1", title: "写方案", done: false }]);
const seen: number[] = [];
store.subscribe((s) => seen.push(s.items[0].done ? 1 : 0));

// 成功：先 true，保持 true
const ok = await store.mutateOptimistic(
  (items) => items.map((t) => (t.id === "1" ? { ...t, done: true } : t)),
  async () => {},
);
assert.deepEqual(ok, { ok: true, rolledBack: false });
assert.equal(store.snapshot().items[0].done, true);
assert.deepEqual(seen, [1], "只通知一次乐观更新");

// 失败：先 true，再回滚 false
seen.length = 0;
const bad = await store.mutateOptimistic(
  (items) => items.map((t) => (t.id === "1" ? { ...t, done: false } : t)),
  async () => { throw new Error("500"); },
);
assert.deepEqual(bad, { ok: false, rolledBack: true });
assert.equal(store.snapshot().items[0].done, true, "失败后回到快照");
assert.deepEqual(seen, [0, 1], "先乐观、再回滚，各通知一次");

// onSettled 无论成败都执行
let settled = 0;
await store.mutateOptimistic((i) => i, async () => { throw new Error("x"); }, { onSettled: () => { settled++; } });
await store.mutateOptimistic((i) => i, async () => {}, { onSettled: () => { settled++; } });
assert.equal(settled, 2);

// 版本守卫：请求期间发生本地变更，晚到响应被丢弃
const pending = store.mutateWithVersion(async () => {
  await new Promise((r) => setTimeout(r, 10));
  return [{ id: "1", title: "服务端旧值", done: false }];
});
// 请求在途时发生一次乐观更新
await store.mutateOptimistic((i) => i.map((t) => ({ ...t, title: "本地新值" })), async () => {});
const guarded = await pending;
assert.equal(guarded.applied, false, "版本已变，丢弃晚到响应");
assert.equal(store.snapshot().items[0].title, "本地新值");

// 没有并发变更时正常应用
const applied = await store.mutateWithVersion(async () => [{ id: "1", title: "服务端", done: true }]);
assert.equal(applied.applied, true);
assert.equal(store.snapshot().items[0].title, "服务端");

console.log("✓ 130-04 乐观更新、快照回滚、onSettled 与版本守卫断言全部通过");
