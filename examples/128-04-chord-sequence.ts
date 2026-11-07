// 文件: examples/128-04-chord-sequence.ts
// 128.6 序列键（chord）：像 "g i" 一样先按前缀再按后续键
// 关键点：前缀状态、超时重置、前缀与单键冲突时的等待窗口、可取消。
import assert from "node:assert/strict";

export interface ChordDefinition {
  sequence: string[]; // ["g", "i"]
  run: () => string;
  description?: string;
}

interface Pending {
  keys: string[];
  at: number;
}

export class ChordMatcher {
  private pending: Pending | null = null;
  private defs: ChordDefinition[] = [];
  private timeoutMs: number;

  constructor(timeoutMs = 1000) {
    this.timeoutMs = timeoutMs;
  }

  register(def: ChordDefinition): void {
    this.defs.push(def);
  }

  /** 是否存在以 keys 为前缀的序列 */
  hasPrefix(keys: string[]): boolean {
    return this.defs.some((d) => keys.every((k, i) => d.sequence[i] === k));
  }

  /** 是否存在完整匹配 */
  exact(keys: string[]): ChordDefinition | undefined {
    return this.defs.find((d) => d.sequence.length === keys.length && d.sequence.every((k, i) => k === keys[i]));
  }

  /**
   * 输入一个键，返回：
   * - { type: "pending" }：已记录的序列前缀，等待后续键
   * - { type: "matched", result }：完整命中
   * - { type: "none" }：无匹配，状态已重置
   */
  feed(key: string, now = Date.now()): { type: "pending"; keys: string[] } | { type: "matched"; result: string } | { type: "none" } {
    const normalized = key.toLowerCase();
    if (this.pending && now - this.pending.at > this.timeoutMs) this.pending = null; // 超时重置
    const keys = this.pending ? [...this.pending.keys, normalized] : [normalized];
    const hit = this.exact(keys);
    if (hit) {
      this.pending = null;
      return { type: "matched", result: hit.run() };
    }
    if (this.hasPrefix(keys)) {
      this.pending = { keys, at: now };
      return { type: "pending", keys };
    }
    this.pending = null;
    return { type: "none" };
  }

  reset(): void {
    this.pending = null;
  }
}

// ---------------- 断言 ----------------
const matcher = new ChordMatcher(1000);
matcher.register({ sequence: ["g", "i"], run: () => "go-imports", description: "跳到引入" });
matcher.register({ sequence: ["g", "d"], run: () => "go-definition", description: "跳到定义" });
matcher.register({ sequence: ["g", "g"], run: () => "go-top", description: "回到顶部" });

let r = matcher.feed("g", 1000);
assert.equal(r.type, "pending");
r = matcher.feed("i", 1100);
assert.deepEqual(r, { type: "matched", result: "go-imports" });

// 超时后前缀失效，i 单独不命中
assert.equal(matcher.feed("g", 2000).type, "pending");
assert.equal(matcher.feed("i", 4000).type, "none");

// 前缀冲突：g 后按 x，整段作废，不会把 x 当成新序列
assert.equal(matcher.feed("g", 5000).type, "pending");
assert.equal(matcher.feed("x", 5100).type, "none");

// 重置后从头开始
matcher.reset();
assert.equal(matcher.feed("g", 6000).type, "pending");
assert.equal(matcher.feed("d", 6100).type, "matched");

// 单键与序列共存：单键应立即命中，序列前缀应等待
const mixed = new ChordMatcher(800);
mixed.register({ sequence: ["g"], run: () => "single-g" });
mixed.register({ sequence: ["g", "i"], run: () => "go-imports" });
assert.deepEqual(mixed.feed("g", 7000), { type: "matched", result: "single-g" }, "完整匹配优先于前缀");

console.log("✓ 128-04 序列键前缀、超时与冲突断言全部通过");
