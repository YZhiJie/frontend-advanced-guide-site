/** 62-02-notification-channel.ts —— 通知通道降级链（WS → SSE → 轮询）+ 游标分页合并去重 */

// --- 通道降级链：按运行环境能力逐级降级,心跳失败触发降一级 ---
type ChannelKind = "websocket" | "sse" | "polling";
interface ChannelEnv {
  wsAvailable: boolean;
  sseAvailable: boolean;
  hidden: boolean; // 页面不可见时轮询也要停
}
function selectChannel(env: ChannelEnv): ChannelKind {
  if (env.wsAvailable) return "websocket";
  if (env.sseAvailable) return "sse";
  return "polling"; // 兜底,万物皆可轮询
}
// 轮询间隔自适应：页面可见 30s,不可见暂停;通知列表页停留时加密到 10s
function pollingInterval(page: "list" | "other", hidden: boolean): number {
  if (hidden) return 0; // 0 = 暂停
  return page === "list" ? 10_000 : 30_000;
}

// --- 游标分页 + 推送合并：列表是"拉"，新通知是"推",两路必须去重合并 ---
interface Notice {
  id: string;
  ts: number; // 服务端时间戳,排序与游标的依据
  title: string;
  read: boolean;
}
class NoticeFeed {
  private byId = new Map<string, Notice>(); // id 唯一索引：推拉两路去重的核心
  private cursor: number | null = null; // 下一页游标 = 当前最旧一条的 ts

  // 拉取一页（ts 倒序）,返回是否还有更多
  ingestPage(page: Notice[]): { hasMore: boolean } {
    for (const n of page) this.byId.set(n.id, n);
    if (page.length > 0) {
      const oldest = page[page.length - 1].ts; // 页尾即最旧
      this.cursor = this.cursor === null ? oldest : Math.min(this.cursor, oldest);
    }
    return { hasMore: page.length > 0 };
  }

  // 推送到达：已存在则更新(可能他端已读),不存在则插入
  ingestPush(n: Notice): boolean {
    const existed = this.byId.has(n.id);
    this.byId.set(n.id, n);
    return !existed;
  }

  // 时间线视图：按 ts 倒序
  timeline(): Notice[] {
    return [...this.byId.values()].sort((a, b) => b.ts - a.ts);
  }

  nextCursor(): number | null {
    return this.cursor;
  }

  // 断线重连补偿：以本地最新 ts 为起点拉缺口
  catchup(latestServer: Notice[]): number {
    const localNewest = this.timeline()[0]?.ts ?? 0;
    let filled = 0;
    for (const n of latestServer) {
      if (n.ts > localNewest && this.ingestPush(n)) filled++;
    }
    return filled;
  }
}

// ---- 断言 ----
// 通道降级
console.assert(
  selectChannel({ wsAvailable: true, sseAvailable: true, hidden: false }) === "websocket",
  "WS 可用优先 WS",
);
console.assert(
  selectChannel({ wsAvailable: false, sseAvailable: true, hidden: false }) === "sse",
  "WS 不可用降 SSE",
);
console.assert(
  selectChannel({ wsAvailable: false, sseAvailable: false, hidden: false }) === "polling",
  "双不可用兜底轮询",
);
console.assert(pollingInterval("list", false) === 10_000, "列表页轮询加密");
console.assert(pollingInterval("other", true) === 0, "页面隐藏停轮询");

// 推拉合并去重
const feed = new NoticeFeed();
feed.ingestPage([
  { id: "a", ts: 300, title: "第三", read: false },
  { id: "b", ts: 200, title: "第二", read: false },
  { id: "c", ts: 100, title: "第一", read: false },
]);
console.assert(feed.nextCursor() === 100, "游标=最旧一条 ts");
// 推送一条与拉取重复的通知：不算新增
console.assert(
  feed.ingestPush({ id: "b", ts: 200, title: "第二", read: true }) === false,
  "推拉重复 id 去重",
);
console.assert(
  feed.timeline().find((n) => n.id === "b")!.read === true,
  "重复到达时以新状态更新(他端已读同步)",
);
// 真新增
console.assert(feed.ingestPush({ id: "d", ts: 400, title: "最新", read: false }) === true, "新推送插入");
console.assert(feed.timeline()[0].id === "d", "时间线倒序最新在前");

// 断线补偿：重连后补齐缺口
const filled = feed.catchup([
  { id: "e", ts: 500, title: "断开期间1", read: false },
  { id: "f", ts: 600, title: "断开期间2", read: false },
  { id: "d", ts: 400, title: "已有", read: false }, // 不缺口
]);
console.assert(filled === 2, "只补缺口,不重拉已有");
console.assert(feed.timeline().length === 6, "补偿后总数正确");

console.log("✅ 通道降级 / 推拉去重 / 游标分页 / 断线补偿全部通过");
