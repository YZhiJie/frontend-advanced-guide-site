// 文件: examples/109-02-card-flip-state-machine.ts
// 卡牌 3D 翻转：状态机（非法迁移拒绝）+ 缓动插值 + 正反面纹理切换时机
// 目标：连点不鬼畜（动画中禁止反向）、角度与时间解耦、过半帧切换纹理

import assert from "node:assert";

type FlipState = "faceDown" | "flippingUp" | "faceUp" | "flippingDown";

/** 合法迁移表：不在表里的迁移一律拒绝 */
const TRANSITIONS: Record<FlipState, FlipState[]> = {
  faceDown: ["flippingUp"],
  flippingUp: ["faceUp"], // 动画中不允许打断——连点不鬼畜的关键
  faceUp: ["flippingDown"],
  flippingDown: ["faceDown"],
};

/** easeInOutCubic：加速-减速，卡牌翻转最常用的缓动 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

class CardFlip {
  state: FlipState = "faceDown";
  private progress = 0; // 0→1 动画进度
  private direction: 1 | -1 = 1; // 1=翻到正面 -1=翻到背面
  constructor(private durationSec = 0.4) {}

  /** 请求翻面；动画进行中返回 false（调用方据此忽略连点） */
  flip(): boolean {
    const next: FlipState | null =
      this.state === "faceDown" ? "flippingUp" : this.state === "faceUp" ? "flippingDown" : null;
    if (next === null) return false;
    assert.ok(TRANSITIONS[this.state].includes(next), `非法迁移 ${this.state} → ${next}`);
    this.direction = next === "flippingUp" ? 1 : -1;
    this.state = next;
    this.progress = 0;
    return true;
  }

  /** 每帧推进，返回当前 rotationY（度，0=背面朝上 180=正面朝上） */
  update(dt: number): number {
    if (this.state === "faceDown") return 0;
    if (this.state === "faceUp") return 180;
    this.progress = Math.min(1, this.progress + dt / this.durationSec);
    const eased = easeInOutCubic(this.progress);
    const done = this.progress >= 1;
    if (done) {
      this.state = this.direction === 1 ? "faceUp" : "faceDown";
      return this.direction === 1 ? 180 : 0;
    }
    return this.direction === 1 ? eased * 180 : 180 - eased * 180;
  }

  /** 当前应显示正面纹理吗？转过 90° 才切换——这是「翻面」视觉的核心 */
  get showFront(): boolean {
    if (this.state === "faceUp") return true;
    if (this.state === "faceDown") return false;
    // 动画中：过半切换
    return this.direction === 1 ? this.progress >= 0.5 : this.progress < 0.5;
  }
}

function runAssertions() {
  // ---------- 测试 1：完整翻面流程 ----------
  const card = new CardFlip(0.4);
  assert.equal(card.state, "faceDown");
  assert.equal(card.update(0), 0);
  assert.ok(card.flip());
  assert.equal(card.state, "flippingUp");
  const mid = card.update(0.2); // 走一半时间
  assert.ok(mid > 0 && mid < 180, `中途角度应在 0~180，实际 ${mid}`);
  const end = card.update(0.25); // 超时长，应钳到 180
  assert.equal(end, 180);
  assert.equal(card.state, "faceUp");
  console.log("[1/4] 完整翻面 OK, 中途角度:", mid.toFixed(1));

  // ---------- 测试 2：连点防鬼畜——动画中 flip 被拒绝 ----------
  const c2 = new CardFlip(0.4);
  assert.ok(c2.flip());
  assert.equal(c2.flip(), false, "flippingUp 中再次 flip 应返回 false");
  c2.update(0.5); // 播完
  assert.equal(c2.state, "faceUp");
  assert.ok(c2.flip(), "播完后才能反向");
  assert.equal(c2.state, "flippingDown");
  console.log("[2/4] 连点防鬼畜 OK");

  // ---------- 测试 3：纹理切换时机——过 90° 才换面 ----------
  const c3 = new CardFlip(0.4);
  c3.flip();
  c3.update(0.1); // 25%：仍应显示背面
  assert.equal(c3.showFront, false);
  c3.update(0.15); // 87.5%：应显示正面
  assert.equal(c3.showFront, true);
  console.log("[3/4] 纹理切换时机 OK");

  // ---------- 测试 4：缓动对称性——easeInOutCubic(0.5) === 0.5 ----------
  const c4 = new CardFlip(0.4);
  c4.flip();
  const halfAngle = c4.update(0.2); // 恰好一半时长
  assert.ok(Math.abs(halfAngle - 90) < 0.001, `半程应恰为 90°，实际 ${halfAngle}`);
  assert.ok(Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-9);
  console.log("[4/4] 缓动对称性 OK, 半程角度:", halfAngle.toFixed(3));

  console.log("\n✅ 109-02 卡牌翻转状态机 全部断言通过");
}

runAssertions();
