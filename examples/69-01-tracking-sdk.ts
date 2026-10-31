// 文件: examples/69-01-tracking-sdk.ts
// ============ 埋点 SDK 内核：批量队列 + 失败重试 + event_id 幂等 + 离线持久化 + 稳定采样 ============
// 与 19.7 的单点片段不同，这里演示的是「体系化内核」：
// 采样在入队前、event_id 在入队时生成、失败回队首、队列落盘（重启恢复）、通道按场景降级。

// ---------------- 类型 ----------------

/** 硬断言：console.assert 在 Node 里只打印不退出，演示脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

type Props = Record<string, unknown>;

/** 一条标准埋点事件：event_id 是幂等键，由客户端生成、服务端据此去重 */
interface TrackEvent {
  event_id: string;
  name: string; // 蛇形命名，如 submit_order_click（见 69-02 的 schema 校验）
  props: Props;
  ts: number;
}

/** 发送通道抽象：浏览器里接 sendBeacon/fetch，演示里接 mock server */
type Transport = (batch: TrackEvent[]) => Promise<void>;

// ---------------- 稳定采样（DJB2 哈希，与 59 册 Web Vitals 采样同源） ----------------

function stableHash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(hash);
}

/** 同一 uid 采样结果恒定：不会「今天上报明天不上报」导致曲线抖动 */
function shouldSample(uid: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return stableHash(uid) % 100 < rate * 100;
}

// ---------------- event_id 生成：时间可排序 + 序号 + 随机后缀 ----------------

let seq = 0;
function genEventId(now: number): string {
  return `${now.toString(36)}-${(seq++).toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ---------------- 持久化抽象：浏览器是 localStorage/IndexedDB，Node 演示用内存 Map ----------------

interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

class MemoryStore implements KVStore {
  private data = new Map<string, string>();
  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}

// ---------------- 上报通道降级链（纯函数）：sendBeacon → fetch keepalive → 普通 fetch ----------------

type Channel = "beacon" | "keepalive" | "fetch";

/** sendBeacon 体积上限（Chrome 约 64KB，见 25.10.3）；超限或不可用就降级 */
const BEACON_LIMIT = 64 * 1024;

function pickChannel(opts: {
  isUnloading: boolean;
  payloadSize: number;
  hasBeacon: boolean;
  hasKeepalive: boolean;
}): Channel {
  if (opts.isUnloading && opts.hasBeacon && opts.payloadSize <= BEACON_LIMIT) {
    return "beacon"; // 卸载阶段唯一保证「发出后不阻塞卸载」的通道
  }
  if (opts.hasKeepalive) return "keepalive"; // fetch keepalive 在卸载后仍可能完成
  return "fetch"; // 最后兜底
}

// ---------------- SDK 内核 ----------------

interface SDKOptions {
  transport: Transport;
  store?: KVStore; // 不传则不持久化
  uid?: string;
  sampleRate?: number; // 0~1，按 uid 稳定哈希
  flushSize?: number; // 攒够 N 条立即发
  flushInterval?: number; // 定时兜底（ms）
  maxQueue?: number; // 队列上限，超出丢最旧的非关键事件
}

const STORE_KEY = "tracking_queue_v1";

class TrackingSDK {
  private queue: TrackEvent[] = [];
  private flushing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private uid: string;
  private readonly sampleRate: number;
  private readonly flushSize: number;
  private readonly flushInterval: number;
  private readonly maxQueue: number;
  private readonly transport: Transport;
  private readonly store?: KVStore;

  /** 丢弃计数：采样丢弃 / 溢出丢弃，用于对数时解释缺口 */
  readonly stats = { sampledOut: 0, overflowDropped: 0, sent: 0, retried: 0 };

  constructor(opts: SDKOptions) {
    this.transport = opts.transport;
    this.store = opts.store;
    this.uid = opts.uid ?? "anonymous";
    this.sampleRate = opts.sampleRate ?? 1;
    this.flushSize = opts.flushSize ?? 10;
    this.flushInterval = opts.flushInterval ?? 5000;
    this.maxQueue = opts.maxQueue ?? 200;
    // 启动时恢复上次未发完的队列（断电/杀进程/崩溃场景的数据兜底）
    if (this.store) {
      const raw = this.store.get(STORE_KEY);
      if (raw) {
        try {
          this.queue = JSON.parse(raw) as TrackEvent[];
          console.log(`[sdk] 从本地恢复 ${this.queue.length} 条未上报事件`);
        } catch {
          this.store.remove(STORE_KEY); // 数据损坏：宁可清空也不让 SDK 崩
        }
      }
    }
  }

  identify(uid: string): void {
    this.uid = uid;
  }

  /** 埋一条事件：采样判定 → 生成 event_id → 入队 → 满批即发 */
  track(name: string, props: Props = {}): boolean {
    if (!shouldSample(this.uid, this.sampleRate)) {
      this.stats.sampledOut++;
      return false;
    }
    this.queue.push({ event_id: genEventId(Date.now()), name, props, ts: Date.now() });
    this.persist();
    if (this.queue.length >= this.flushSize) void this.flush();
    return true;
  }

  /** 把当前队列一次性发出；失败整批回队首，下轮优先重发（event_id 保证重发不产生重复） */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.flushing = true;
    try {
      await this.transport(batch);
      this.stats.sent += batch.length;
      this.persist();
      console.log(`[sdk] 上报成功 ${batch.length} 条（累计已发 ${this.stats.sent}）`);
    } catch (err) {
      this.queue = [...batch, ...this.queue];
      // 队列上限保护：长时间断网不能无限堆积，丢最旧的保住内存
      if (this.queue.length > this.maxQueue) {
        const dropped = this.queue.length - this.maxQueue;
        this.queue = this.queue.slice(-this.maxQueue);
        this.stats.overflowDropped += dropped;
        console.warn(`[sdk] 队列溢出，丢弃最旧 ${dropped} 条`);
      }
      this.stats.retried++;
      this.persist();
      console.warn(
        `[sdk] 上报失败（${err instanceof Error ? err.message : err}），已回队首待重试，当前积压 ${this.queue.length} 条`,
      );
    } finally {
      this.flushing = false;
    }
  }

  startAutoFlush(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushInterval);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 页面卸载时调用：按降级链选通道（浏览器里 beacon 直发，此处演示选路逻辑） */
  flushOnUnload(hasBeacon: boolean, hasKeepalive: boolean): Channel {
    const payloadSize = JSON.stringify(this.queue).length;
    const channel = pickChannel({
      isUnloading: true,
      payloadSize,
      hasBeacon,
      hasKeepalive,
    });
    console.log(`[sdk] 卸载兜底：payload ${payloadSize}B → 通道 ${channel}`);
    return channel;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  private persist(): void {
    this.store?.set(STORE_KEY, JSON.stringify(this.queue));
  }
}

// ---------------- mock 服务端：按 event_id 幂等去重 ----------------

class MockServer {
  private seen = new Set<string>();
  readonly received: TrackEvent[] = [];
  duplicated = 0;
  failTimes = 0; // 脚本化故障：接下来 N 次请求全部 503

  async ingest(batch: TrackEvent[]): Promise<void> {
    if (this.failTimes > 0) {
      this.failTimes--;
      throw new Error("HTTP 503 服务不可用");
    }
    for (const e of batch) {
      if (this.seen.has(e.event_id)) {
        this.duplicated++; // 网络重试/超时重发造成的重复投递，按 event_id 拦下
        continue;
      }
      this.seen.add(e.event_id);
      this.received.push(e);
    }
  }
}

// ---------------- 演示 ----------------

async function main() {
  console.log("===== 1. 采样：稳定哈希，同一 uid 结果恒定 =====");
  const sid = "user-10086";
  assert(shouldSample(sid, 0.5) === shouldSample(sid, 0.5), "同一 uid 采样必须一致");
  let hit = 0;
  for (let i = 0; i < 10000; i++) if (shouldSample(`u-${i}`, 0.1)) hit++;
  assert(hit > 500 && hit < 1500, `10% 采样应命中约 1000，实际 ${hit}`);
  console.log(`10% 采样在 10000 个用户中命中 ${hit} 个（期望约 1000）✅`);

  console.log("\n===== 2. 批量上报：攒够 10 条立即发 =====");
  const server = new MockServer();
  const sdk = new TrackingSDK({
    transport: (b) => server.ingest(b),
    flushSize: 10,
    flushInterval: 60_000, // 调大排除定时干扰，演示手动 flush
  });
  for (let i = 0; i < 12; i++) sdk.track("banner_click", { pos: i });
  await new Promise((r) => setTimeout(r, 10)); // 等满批触发的 flush 完成
  assert(server.received.length === 10, `满 10 条应立即发一批，实际收到 ${server.received.length}`);
  assert(sdk.pendingCount() === 2, "剩余 2 条应在队列中");
  await sdk.flush();
  assert(server.received.length === 12, "手动 flush 后应收齐 12 条");
  console.log("满批即发 + 手动 flush 验证通过 ✅");

  console.log("\n===== 3. 失败重试 + event_id 幂等去重 =====");
  const server2 = new MockServer();
  server2.failTimes = 2; // 接下来 2 次上报都会失败
  const store2 = new MemoryStore();
  const sdk2 = new TrackingSDK({
    transport: (b) => server2.ingest(b),
    store: store2,
    flushSize: 100,
  });
  sdk2.track("submit_order_click", { order_id: "A-1" });
  sdk2.track("pay_success", { order_id: "A-1", amount: 9900 });
  await sdk2.flush(); // 失败 → 回队首
  assert(sdk2.pendingCount() === 2, "失败后 2 条应回队");
  await sdk2.flush(); // 仍失败
  await sdk2.flush(); // 恢复 → 成功
  assert(server2.received.length === 2, "恢复后应收齐 2 条");
  // 模拟网络层重发导致的重复投递（同批数据再到一次）
  const sameBatch = server2.received.slice();
  await server2.ingest(sameBatch);
  assert(server2.duplicated === 2, `重复投递应被 event_id 拦下，实际拦截 ${server2.duplicated}`);
  assert(server2.received.length === 2, "去重后总条数不变");
  console.log("失败回队 + 重复投递幂等去重验证通过 ✅");

  console.log("\n===== 4. 离线持久化：进程重启后恢复队列 =====");
  // sdk2 此刻队列已空；模拟「埋了 3 条但进程被杀」：新实例从同一份 store 恢复
  sdk2.track("app_crash_before_flush", { screen: "home" });
  const sdk3 = new TrackingSDK({
    transport: (b) => server2.ingest(b),
    store: store2, // 同一份本地存储 = 同一次设备上的重启
    flushSize: 100,
  });
  assert(sdk3.pendingCount() === 1, "重启后应恢复 1 条未上报事件");
  await sdk3.flush();
  assert(server2.received.length === 3, "恢复的事件应补发成功");
  console.log("断电/杀进程场景的数据兜底验证通过 ✅");

  console.log("\n===== 5. 通道降级链：卸载兜底选路 =====");
  const small = { isUnloading: true, payloadSize: 1024, hasBeacon: true, hasKeepalive: true };
  const big = { isUnloading: true, payloadSize: 100 * 1024, hasBeacon: true, hasKeepalive: true };
  const noBeacon = { isUnloading: true, payloadSize: 1024, hasBeacon: false, hasKeepalive: true };
  const legacy = { isUnloading: true, payloadSize: 1024, hasBeacon: false, hasKeepalive: false };
  assert(pickChannel(small) === "beacon", "小 payload 卸载时应选 sendBeacon");
  assert(pickChannel(big) === "keepalive", "超 64KB 应降级 fetch keepalive");
  assert(pickChannel(noBeacon) === "keepalive", "无 beacon 应降级 keepalive");
  assert(pickChannel(legacy) === "fetch", "都不支持时退回普通 fetch");
  console.log("beacon → keepalive → fetch 降级链验证通过 ✅");

  console.log("\n✅ 埋点 SDK 内核全部演示通过");
  console.log(
    `统计：采样丢弃 ${sdk.stats.sampledOut} / 溢出丢弃 ${sdk2.stats.overflowDropped + sdk3.stats.overflowDropped} / 重试 ${sdk2.stats.retried} 次`,
  );
}

void main();
