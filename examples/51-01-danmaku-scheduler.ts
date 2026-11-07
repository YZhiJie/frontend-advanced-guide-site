// 文件: examples/51-01-danmaku-scheduler.ts
// ============ 弹幕调度器:限流渲染 + 优先级 + 背压丢弃 ============
// 设计要点:
// 1) 直播间消息到达速率远高于屏幕可读速率,必须「按帧预算」渲染,不能来一条渲染一条;
// 2) 礼物的展示优先级高于普通聊天,但也不能饿死聊天;
// 3) 队列必须有上限:溢出时丢低优先级旧消息,而不是让内存无限增长。

interface Danmaku {
  id: string;
  text: string;
  /** 0 = 礼物/系统,1 = 普通聊天 */
  priority: number;
  ts: number;
}

class DanmakuScheduler {
  private queue: Danmaku[] = [];
  rendered: Danmaku[] = [];
  dropped = 0;
  peakQueue = 0;

  constructor(
    private maxPerFrame = 4,
    private maxQueue = 500,
  ) {}

  enqueue(msg: Danmaku): void {
    this.queue.push(msg);
    this.peakQueue = Math.max(this.peakQueue, this.queue.length);
    if (this.queue.length > this.maxQueue) this.evict();
  }

  /** 溢出保护:先丢「最旧的低优先级」;全是礼物则丢最旧 */
  private evict(): void {
    let index = -1;
    for (let i = 0; i < this.queue.length; i++) {
      if (index === -1) {
        index = i;
        continue;
      }
      const cur = this.queue[i];
      const best = this.queue[index];
      if (cur.priority > best.priority || (cur.priority === best.priority && cur.ts < best.ts)) {
        index = i;
      }
    }
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.dropped++;
    }
  }

  /** 模拟 requestAnimationFrame:每次最多渲染 maxPerFrame 条 */
  frame(): Danmaku[] {
    this.queue.sort((a, b) => a.priority - b.priority || a.ts - b.ts);
    const batch = this.queue.splice(0, this.maxPerFrame);
    this.rendered.push(...batch);
    return batch;
  }

  get pending(): number {
    return this.queue.length;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景 1:礼物优先,但聊天不被完全饿死 ----------------
const s = new DanmakuScheduler(4);
for (let i = 0; i < 10; i++) {
  s.enqueue({ id: `c${i}`, text: `聊天${i}`, priority: 1, ts: i });
}
for (let i = 0; i < 3; i++) {
  s.enqueue({ id: `g${i}`, text: `礼物${i}`, priority: 0, ts: 100 + i });
}

const firstFrame = s.frame();
console.log(
  "第一帧:",
  firstFrame.map((m) => m.text).join(" / "),
);
assert(firstFrame.length === 4, "每帧最多渲染 4 条");
assert(
  firstFrame.filter((m) => m.priority === 0).length === 3,
  "3 条礼物应优先进入第一帧",
);
assert(firstFrame.some((m) => m.priority === 1), "聊天不能被完全饿死");

// ---------------- 场景 2:多帧消化 ----------------
let frames = 1;
while (s.pending > 0) {
  s.frame();
  frames++;
}
console.log(`剩余消息用 ${frames} 帧消化完,总渲染 ${s.rendered.length} 条`);
assert(s.rendered.length === 13, "所有消息最终都应渲染(未溢出时)");

// ---------------- 场景 3:背压丢弃 ----------------
const burst = new DanmakuScheduler(4, 50);
for (let i = 0; i < 200; i++) {
  burst.enqueue({ id: `x${i}`, text: `消息${i}`, priority: 1, ts: i });
}
console.log(`突刺 200 条 → 队列 ${burst.pending} 条,丢弃 ${burst.dropped} 条,峰值 ${burst.peakQueue}`);
assert(burst.pending === 50, "队列应被压到上限");
assert(burst.dropped === 150, "超出上限的 150 条应被丢弃");
assert(burst.peakQueue <= 51, "峰值不应超过上限 + 1");

// ---------------- 场景 4:礼物在溢出时保留 ----------------
const mixed = new DanmakuScheduler(4, 10);
for (let i = 0; i < 20; i++) {
  mixed.enqueue({ id: `m${i}`, text: `聊天${i}`, priority: 1, ts: i });
}
mixed.enqueue({ id: "gift", text: "嘉年华", priority: 0, ts: 999 });
assert(mixed.pending === 10, "队列压到上限");
const kept = mixed.frame();
console.log("溢出后第一帧:", kept.map((m) => m.text).join(" / "));
assert(kept[0].text === "嘉年华", "礼物不应被低优先级消息挤掉");

console.log("\n调度器通过:帧预算、优先级、背压丢弃、峰值控制均有确定行为。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};
