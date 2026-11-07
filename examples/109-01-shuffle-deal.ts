// 文件: examples/109-01-shuffle-deal.ts
// 洗牌与发牌：Fisher-Yates 洗牌 + 种子随机数（可复现回放）+ 发牌动画队列
// 目标：公平性可证明、对局可回放（同种子必同序列）、动画与逻辑分离

import assert from "node:assert";

/** mulberry32：32 位种子 PRNG，周期 2^32，质量足够游戏用（不要用于安全场景） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌：唯一无偏的原地洗牌算法，O(n) */
function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)); // 关键：j 取自 [0, i]，不是 [0, n)
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface Card {
  suit: "♠" | "♥" | "♣" | "♦";
  rank: number; // 1-13
}

function newDeck(): Card[] {
  const suits: Card["suit"][] = ["♠", "♥", "♣", "♦"];
  const deck: Card[] = [];
  for (const suit of suits) for (let rank = 1; rank <= 13; rank++) deck.push({ suit, rank });
  return deck;
}

/** 发牌调度器：逻辑瞬间完成，动画按时序逐个触发——二者必须分离 */
class DealScheduler {
  private queue: Array<{ card: Card; target: number; at: number }> = [];
  private t = 0;
  constructor(private intervalSec = 0.15) {}

  /** 轮流向 target 0..players-1 发 count 张 */
  schedule(deck: Card[], players: number, count: number): void {
    for (let n = 0; n < count; n++) {
      for (let p = 0; p < players; p++) {
        const card = deck.shift();
        if (!card) return;
        this.queue.push({ card, target: p, at: this.t });
        this.t += this.intervalSec;
      }
    }
  }

  /** 返回 now 时刻应已发出的全部牌（按 at 排序） */
  drainUntil(now: number): Array<{ card: Card; target: number }> {
    const due = this.queue.filter((e) => e.at <= now);
    this.queue = this.queue.filter((e) => e.at > now);
    return due;
  }

  get pending(): number {
    return this.queue.length;
  }
}

function runAssertions() {
  // ---------- 测试 1：同种子必同序列（回放根基） ----------
  const d1 = shuffle(newDeck(), mulberry32(42));
  const d2 = shuffle(newDeck(), mulberry32(42));
  const d3 = shuffle(newDeck(), mulberry32(43));
  assert.deepEqual(d1, d2, "同种子洗牌结果必须一致");
  assert.notDeepEqual(d1.slice(0, 5), d3.slice(0, 5), "不同种子应不同");
  console.log("[1/4] 种子可复现 OK, 首张:", `${d1[0].suit}${d1[0].rank}`);

  // ---------- 测试 2：无偏性粗检——每张牌出现在首位的频率应趋近 1/52 ----------
  const trials = 52000;
  const firstCount = new Map<string, number>();
  const rand = mulberry32(7);
  for (let i = 0; i < trials; i++) {
    const d = shuffle(newDeck(), rand);
    const key = `${d[0].suit}${d[0].rank}`;
    firstCount.set(key, (firstCount.get(key) ?? 0) + 1);
  }
  assert.equal(firstCount.size, 52, "52 张牌都应能出现在首位");
  for (const [, c] of firstCount) {
    // 期望 1000 次，±30% 容差内视为均匀（统计波动）
    assert.ok(c > 700 && c < 1300, `频率异常: ${c}`);
  }
  console.log("[2/4] 无偏性粗检 OK, 52 张均上榜, 频次区间:", Math.min(...firstCount.values()), "-", Math.max(...firstCount.values()));

  // ---------- 测试 3：发牌调度——时序与轮转 ----------
  const deck = shuffle(newDeck(), mulberry32(1));
  const sched = new DealScheduler(0.15);
  sched.schedule([...deck], 4, 2); // 4 人每人 2 张共 8 张
  assert.equal(sched.pending, 8);
  const t0 = sched.drainUntil(0.01); // 第 1 张
  assert.equal(t0.length, 1);
  assert.equal(t0[0].target, 0);
  const t1 = sched.drainUntil(0.61); // 应发完前 5 张中的剩余（0.15/0.3/0.45/0.6）
  assert.equal(t1.length, 4);
  assert.deepEqual(t1.map((e) => e.target), [1, 2, 3, 0], "轮转顺序");
  console.log("[3/4] 发牌调度 OK, 剩余:", sched.pending);

  // ---------- 测试 4：牌堆守恒——发出+剩余=52，无重复 ----------
  const deck2 = shuffle(newDeck(), mulberry32(99));
  const total = deck2.length;
  const sched2 = new DealScheduler(0.1);
  const working = [...deck2];
  sched2.schedule(working, 2, 5); // 发 10 张
  assert.equal(working.length, total - 10);
  const dealt = sched2.drainUntil(999);
  const keys = new Set(dealt.map((e) => `${e.card.suit}${e.card.rank}`));
  assert.equal(keys.size, 10, "发出的牌不得重复");
  console.log("[4/4] 牌堆守恒 OK, 发出:", dealt.length, "剩余:", working.length);

  console.log("\n✅ 109-01 洗牌与发牌 全部断言通过");
}

runAssertions();
