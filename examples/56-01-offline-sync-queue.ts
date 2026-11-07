// 文件: examples/56-01-offline-sync-queue.ts
// ============ 离线优先同步引擎:写队列、幂等重放、指数退避与版本冲突 ============
// 设计要点:
// 1) 离线优先的核心不是「断网也能用」,而是「断网期间的每一次变更都有落盘与重放保证」;
// 2) 幂等键是重放安全的前提:同一次操作重发 N 次,服务端只生效一次;
// 3) 冲突要在写操作时就带上 baseVersion,不能等服务端报错了再想办法。

interface PendingOp {
  opId: string; // 幂等键:客户端生成(UUID/递增均可)
  entity: string;
  entityId: string;
  type: "create" | "update" | "delete";
  payload: Record<string, unknown>;
  baseVersion: number; // 客户端基于哪个版本做的修改
  ts: number;
}

/** 极简持久层:真实项目换 AsyncStorage / MMKV / IndexedDB,接口不变 */
class MemoryStorage {
  private data = new Map<string, string>();
  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string) {
    this.data.set(key, value);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

/** 服务端 mock:记录实体版本与已生效的幂等键 */
class MockServer {
  versions = new Map<string, number>();
  applied = new Set<string>();
  received: PendingOp[] = [];

  apply(op: PendingOp): { ok: boolean; conflict?: boolean } {
    this.received.push(op);
    if (this.applied.has(op.opId)) return { ok: true }; // 幂等:重复请求直接成功
    const cur = this.versions.get(op.entityId) ?? 0;
    if (op.type !== "create" && op.baseVersion !== cur) {
      return { ok: false, conflict: true };
    }
    this.versions.set(op.entityId, cur + 1);
    this.applied.add(op.opId);
    return { ok: true };
  }
}

/** 同步引擎:入队即持久化,flush 只在在线时按序重放 */
class SyncQueue {
  private queue: PendingOp[] = [];
  private attempts = 0;

  constructor(
    private storage: MemoryStorage,
    private server: MockServer,
    private onConflict: (op: PendingOp) => "keep-server" | "overwrite" = () =>
      "keep-server",
  ) {}

  enqueue(op: PendingOp) {
    this.queue.push(op);
    this.persist();
  }

  get size() {
    return this.queue.length;
  }
  get retryCount() {
    return this.attempts;
  }

  private persist() {
    this.storage.set("pending-ops", JSON.stringify(this.queue));
  }

  /** 离线(online=false)时整批保留,退避计数 +1;在线时按序重放 */
  async flush(online: boolean): Promise<number> {
    if (!online) {
      this.attempts++;
      return 0;
    }
    let applied = 0;
    for (const op of this.queue) {
      let res = this.server.apply(op);
      if (res.conflict) {
        const action = this.onConflict(op);
        if (action === "overwrite") {
          // 以服务端最新版本为基底强制重放(真实实现通常弹窗让用户选)
          op.baseVersion = this.server.versions.get(op.entityId) ?? 0;
          res = this.server.apply(op);
        } else {
          res = { ok: true }; // keep-server:本地放弃,视为已处理
        }
      }
      if (res.ok) applied++;
    }
    this.queue = [];
    this.persist();
    this.attempts = 0; // 成功后清零退避
    return applied;
  }

  /** App 重启后从持久层恢复队列 */
  restore() {
    const raw = this.storage.get("pending-ops");
    if (raw) this.queue = JSON.parse(raw) as PendingOp[];
  }
}

const op = (n: number, entityId: string, baseVersion = 0): PendingOp => ({
  opId: `op_${n}`,
  entity: "todo",
  entityId,
  type: "update",
  payload: { title: `任务 ${n}` },
  baseVersion,
  ts: 1_700_000_000_000 + n,
});

// ---------------- 场景 1:离线入队不丢,退避计数递增 ----------------
const storage = new MemoryStorage();
const server = new MockServer();
const q = new SyncQueue(storage, server);

q.enqueue(op(1, "t1"));
q.enqueue(op(2, "t2"));
await q.flush(false); // 断网
await q.flush(false); // 还是断网
console.log("离线两次 flush 后队列:", q.size, "条,退避次数:", q.retryCount);
assert(q.size === 2, "离线时队列不能清空");
assert(q.retryCount === 2, "每次离线 flush 都应累计退避");

// ---------------- 场景 2:网络恢复按序重放,成功后退避清零 ----------------
const applied = await q.flush(true);
console.log("恢复在线后生效:", applied, "条");
assert(applied === 2 && q.size === 0, "恢复后应按序全部生效");
assert(q.retryCount === 0, "成功后退避计数应清零");
assert(
  server.versions.get("t1") === 1 && server.versions.get("t2") === 1,
  "两个实体各前进一个版本",
);

// ---------------- 场景 3:幂等——重复 opId 不产生二次效果 ----------------
const dup = op(1, "t1");
dup.baseVersion = 1; // 与服务端当前版本对齐,排除冲突干扰
q.enqueue(dup);
await q.flush(true);
const receivedCount = server.received.filter((o) => o.opId === "op_1").length;
console.log(
  "op_1 收到",
  receivedCount,
  "次,实际生效版本:",
  server.versions.get("t1"),
);
assert(receivedCount >= 2, "同一 opId 应被重发到服务端");
assert(
  server.versions.get("t1") === 1,
  "幂等键相同则服务端只生效一次,版本不再前进",
);

// ---------------- 场景 4:版本冲突——默认 keep-server 丢弃本地 ----------------
server.versions.set("t9", 3); // 服务端已经走到 v3
const stale = op(4, "t9", 0); // 本地还基于 v0 修改
const q4 = new SyncQueue(storage, server);
q4.enqueue(stale);
const r4 = await q4.flush(true);
assert(r4 === 1 && q4.size === 0, "冲突按 keep-server 策略落地");
assert(server.versions.get("t9") === 3, "过期修改不应覆盖服务端新版本");

// ---------------- 场景 5:重启恢复——新引擎从持久层读回队列 ----------------
const q5 = new SyncQueue(storage, server);
q5.enqueue(op(5, "t5"));
const restored = new SyncQueue(storage, server);
restored.restore();
assert(restored.size === 1, "重启后队列应从持久层完整恢复");
const appliedRestored = await restored.flush(true);
assert(appliedRestored === 1, "恢复后的队列可以正常重放");

console.log(
  "\n离线同步引擎通过:落盘、重放、幂等、退避、冲突、恢复均有确定行为。",
);

// 标记为模块,避免与其它示例的顶层变量重名
export {};
