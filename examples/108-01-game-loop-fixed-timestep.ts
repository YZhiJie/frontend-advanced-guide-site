// 文件: examples/108-01-game-loop-fixed-timestep.ts
// 游戏主循环：固定时间步长 update + 插值 render，死亡螺旋钳制，帧率统计
// 目标：逻辑帧率与渲染帧率解耦——低端机掉帧时游戏速度不变慢

import assert from "node:assert";

interface LoopHooks {
  update(dt: number): void; // 固定步长逻辑更新，dt 恒等于 step（秒）
  render(alpha: number): void; // 渲染，alpha 为插值因子 [0,1)，用于平滑动画
}

class GameLoop {
  readonly step: number; // 固定步长（秒），物理/逻辑一律按它推进
  private acc = 0; // 时间累积器：没攒够一个 step 就不 update
  private last: number | null = null; // 上一帧时间戳
  private readonly maxStepsPerFrame = 5; // 单帧最多补的步数：死亡螺旋钳制
  frames = 0; // render 调用次数
  updates = 0; // update 调用次数
  clampedFrames = 0; // 触发钳制的帧数（用于监控卡顿）

  constructor(step: number, private hooks: LoopHooks) {
    this.step = step;
  }

  /** 由 requestAnimationFrame 每帧驱动，now 单位秒 */
  tick(now: number): void {
    if (this.last === null) {
      this.last = now;
      this.hooks.render(0);
      this.frames++;
      return;
    }
    this.acc += now - this.last;
    this.last = now;

    let steps = 0;
    while (this.acc >= this.step && steps < this.maxStepsPerFrame) {
      this.hooks.update(this.step);
      this.acc -= this.step;
      steps++;
      this.updates++;
    }
    // 帧时间过长（切后台回来/卡顿）：丢弃积压时间，宁可慢动作也不追帧
    if (steps === this.maxStepsPerFrame && this.acc >= this.step) {
      this.acc = 0;
      this.clampedFrames++;
    }
    this.hooks.render(this.acc / this.step);
    this.frames++;
  }
}

/** 滑动窗口帧率统计：近 windowSec 秒内的实际 FPS */
class FpsMeter {
  private stamps: number[] = [];
  constructor(private windowSec = 1) {}
  push(now: number): void {
    this.stamps.push(now);
    while (this.stamps.length && this.stamps[0] <= now - this.windowSec) {
      this.stamps.shift();
    }
  }
  get fps(): number {
    return this.stamps.length / this.windowSec;
  }
}

function runAssertions() {
  // ---------- 测试 1：稳定 60fps 下 update 与 render 次数 ----------
  const positions: number[] = [];
  let x = 0;
  const loop = new GameLoop(1 / 60, {
    update: (dt) => {
      x += dt * 100; // 100 单位/秒匀速
    },
    render: (alpha) => positions.push(x + alpha * (100 / 60)),
  });
  // 模拟 61 帧（t=0 到 t=1s，每 16.667ms 一帧）
  for (let i = 0; i <= 60; i++) loop.tick(i / 60);
  assert.equal(loop.frames, 61);
  assert.ok(loop.updates >= 59 && loop.updates <= 61, `updates=${loop.updates}`);
  assert.ok(Math.abs(x - 100) < 2, `1 秒应前进 ~100 单位，实际 ${x}`);
  console.log("[1/4] 稳定 60fps OK, updates:", loop.updates, "x:", x.toFixed(2));

  // ---------- 测试 2：低端机 30fps，游戏速度不变慢 ----------
  const loop2 = new GameLoop(1 / 60, { update: (dt) => { x2 += dt * 100; }, render: () => {} });
  let x2 = 0;
  for (let i = 0; i <= 30; i++) loop2.tick(i / 30); // 30fps 跑 1 秒
  assert.ok(Math.abs(x2 - 100) < 2, `30fps 下 1 秒仍应前进 ~100，实际 ${x2}`);
  assert.ok(loop2.updates > loop2.frames, "每帧补 2 步，updates 应多于 frames");
  console.log("[2/4] 30fps 速度一致 OK, updates:", loop2.updates, "frames:", loop2.frames);

  // ---------- 测试 3：切后台 10 秒回来，死亡螺旋被钳制 ----------
  const loop3 = new GameLoop(1 / 60, { update: () => {}, render: () => {} });
  loop3.tick(0);
  loop3.tick(10); // 切后台 10 秒
  assert.equal(loop3.updates, 5, "单帧最多补 5 步");
  assert.equal(loop3.clampedFrames, 1);
  console.log("[3/4] 死亡螺旋钳制 OK, 补步:", loop3.updates);

  // ---------- 测试 4：帧率统计 ----------
  const meter = new FpsMeter(1);
  for (let i = 0; i <= 120; i++) meter.push(i / 60);
  assert.ok(Math.abs(meter.fps - 60) < 2, `fps 应约 60，实际 ${meter.fps}`);
  console.log("[4/4] 帧率统计 OK, fps:", meter.fps.toFixed(1));

  console.log("\n✅ 108-01 游戏主循环 全部断言通过");
}

runAssertions();
