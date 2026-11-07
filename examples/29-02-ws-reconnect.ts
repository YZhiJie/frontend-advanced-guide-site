// 文件: examples/29-02-ws-reconnect.ts
// ============ WebSocket 心跳与自动重连：defer 重建 + 指数退避 + share 多播 + 统一收口 ============
// 把 29.5「实战案例：WebSocket 心跳与自动重连」落成可执行代码。
// 正文用 rxjs/webSocket 连真实服务端；这里把「建连」抽象成 connect 工厂注入，
// 用 MockSocket + marble 脚本模拟「第一代连接发一条行情后断线、第二代稳定服役」，
// 其余操作符编排与正文逐行同构：
//   defer(建连) → retry({ delay: 指数退避封顶 }) → takeUntil(destroy$) → share()
// 被验证的硬性质：
// - 断线以 error 终结后按退避自动重连，重连间隔精确等于 backoff(1)；
// - 心跳随连接建立启动、随断线/卸载由 finalize 停表（ping 计数可证）；
// - ticks$/notices$ 两个订阅者共享同一条连接（share 在 retry 之后，每代只建连一次）；
// - destroy$ 后全部流完成，不再有任何 ping 与消息。

import { defer, interval, Subject, timer, type Observable } from "rxjs";
import { filter, finalize, map, retry, share, takeUntil } from "rxjs/operators";
import { TestScheduler } from "rxjs/testing";

/** 硬断言：console.assert 在 Node 里不阻断，脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

type ServerMessage = { type: "tick" | "notice"; payload: unknown };
type ClientMessage = { type: "ping" };

// ---------------- 被测实现：与正文 29.5 同构 ----------------

interface RealtimeChannelOptions {
  /** 心跳间隔，正文 15000ms；测试用 3 帧 */
  heartbeatMs?: number;
  /** 重连退避（毫秒/帧），正文为 Math.min(2 ** attempt * 500, 15000) */
  backoffMs?: (attempt: number) => number;
}

/** 正文同款退避：2 的幂次增长、15 秒封顶——不封顶 timer 会被天文数字撑爆 */
const chapterBackoff = (attempt: number): number => Math.min(2 ** attempt * 500, 15000);

function createRealtimeChannel(
  connect: () => Observable<ServerMessage>,
  destroy$: Observable<void>,
  options: RealtimeChannelOptions = {},
) {
  const heartbeatMs = options.heartbeatMs ?? 15000;
  const backoffMs = options.backoffMs ?? chapterBackoff;

  const source$ = defer(() => {
    const socket = new MockSocket();
    sockets.push(socket);
    // 心跳借用上行通道直接 send；断线/重连/卸载三条路径都由 finalize 停表
    const heartbeat = interval(heartbeatMs).subscribe(() => socket.send({ type: "ping" }));
    return connect().pipe(finalize(() => heartbeat.unsubscribe()));
  }).pipe(
    retry({ delay: (_, attempt) => timer(backoffMs(attempt)) }),
    takeUntil(destroy$),
    // share 必须放在 retry/takeUntil 之后：多个订阅者复用同一条连接；
    // 放错位置会让每个订阅者各自重连、各自心跳，服务端看到连接数暴涨
    share(),
  );

  const pick = <T extends ServerMessage["type"]>(type: T) =>
    source$.pipe(
      filter((m): m is ServerMessage => m.type === type),
      map((m) => m.payload),
    );

  return { ticks$: pick("tick"), notices$: pick("notice") };
}

// ---------------- 测试夹具：记录上行 ping 的模拟 socket ----------------

class MockSocket {
  readonly sent: ClientMessage[] = [];
  send(message: ClientMessage): void {
    this.sent.push(message);
  }
}

const sockets: MockSocket[] = [];

const makeScheduler = () =>
  new TestScheduler((actual, expected) => {
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      `帧记录不符\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`,
    );
  });

// ---------------- 退避公式：纯函数先把正文的账算清 ----------------

assert(chapterBackoff(1) === 1000, `第 1 次退避应为 1000ms，实际 ${chapterBackoff(1)}`);
assert(chapterBackoff(2) === 2000, `第 2 次退避应为 2000ms，实际 ${chapterBackoff(2)}`);
assert(chapterBackoff(3) === 4000, `第 3 次退避应为 4000ms，实际 ${chapterBackoff(3)}`);
assert(chapterBackoff(4) === 8000, `第 4 次退避应为 8000ms，实际 ${chapterBackoff(4)}`);
assert(chapterBackoff(5) === 15000, `第 5 次应封顶 15000ms，实际 ${chapterBackoff(5)}`);
assert(chapterBackoff(20) === 15000, `第 20 次仍应封顶 15000ms，实际 ${chapterBackoff(20)}`);
console.log("✓ 退避公式：指数增长且 15s 封顶，timer 不会拿到非法延迟");

// ---------------- 主场景：断线 → 退避重连 → 共享 → 卸载收口 ----------------

const ts = makeScheduler();

ts.run(({ cold, hot, flush }) => {
  let generation = 0;
  const backoffAttempts: number[] = [];

  // 每代连接的「下行剧本」：第一代 f2 推一条行情、f10 以 error 断线；
  // 第二代 f2 推行情、f5 推公告，之后静默等待页面卸载
  const connect = (): Observable<ServerMessage> => {
    generation += 1;
    return generation === 1
      ? cold("--t-------#", { t: { type: "tick", payload: "价格-1" } }, new Error("连接丢失"))
      : cold("--t--n-------", {
          t: { type: "tick", payload: "价格-2" },
          n: { type: "notice", payload: "复牌公告" },
        });
  };

  const destroy$ = hot("-----------------------d---"); // f23 页面卸载
  const channel = createRealtimeChannel(connect, destroy$, {
    heartbeatMs: 3,
    backoffMs: (attempt) => {
      backoffAttempts.push(attempt);
      return 5; // 测试尺度：5 帧后重连
    },
  });

  // 两个业务模块同时订阅：若 share 位置错误，这里会看到 2 倍建连
  const ticks: Array<{ f: number; v: unknown }> = [];
  const notices: Array<{ f: number; v: unknown }> = [];
  let ticksCompleted = false;
  let noticesCompleted = false;
  channel.ticks$.subscribe({
    next: (v) => ticks.push({ f: ts.now(), v }),
    complete: () => (ticksCompleted = true),
  });
  channel.notices$.subscribe({
    next: (v) => notices.push({ f: ts.now(), v }),
    complete: () => (noticesCompleted = true),
  });

  flush();

  // 消息时间线：gen1 tick@f2；gen2 tick@f17（f10 断线 + 5 帧退避 → f15 重建，剧本 f2 发出）；
  // gen2 notice@f20
  assert(ticks.length === 2 && ticks[0].f === 2 && ticks[1].f === 17,
    `tick 应为 [f2, f17]，实际 ${JSON.stringify(ticks)}`);
  assert(ticks[0].v === "价格-1" && ticks[1].v === "价格-2", "两代连接的 tick 应分别送达");
  assert(notices.length === 1 && notices[0].f === 20 && notices[0].v === "复牌公告",
    `notice 应为 f20 复牌公告，实际 ${JSON.stringify(notices)}`);

  // 建连：断线后恰好重连 1 次；share 让 2 个订阅者每代只建 1 条连接
  assert(sockets.length === 2, `应建连 2 代共 2 条，实际 ${sockets.length} 条`);
  assert(generation === 2, `connect 应被调用 2 次，实际 ${generation} 次`);
  assert(backoffAttempts.length === 1 && backoffAttempts[0] === 1,
    `retry 应以 attempt=1 退避一次，实际 ${JSON.stringify(backoffAttempts)}`);

  // 心跳：gen1 在 f3/f6/f9 各一 ping（f10 断线后 finalize 停表）；
  // gen2 在 f18/f21 各一 ping（f23 卸载后不再发）
  assert(sockets[0].sent.length === 3, `gen1 应有 3 次心跳，实际 ${sockets[0].sent.length}`);
  assert(sockets[1].sent.length === 2, `gen2 应有 2 次心跳，实际 ${sockets[1].sent.length}`);

  // 收口：destroy$ 后两条分流都完成，不会再有任何投递
  assert(ticksCompleted && noticesCompleted, "destroy$ 后 ticks$/notices$ 应完成");
});

console.log("✓ 断线重连：error 终结后按退避重建，消息时间线精确到帧");
console.log("✓ 心跳停表：断线与卸载两条路径，ping 计数立即冻结");
console.log("✓ share 多播：两个订阅者共享连接，每代只建连一次");
console.log("\n全部断言通过：defer + retry + takeUntil + share 的重连编排成立");
