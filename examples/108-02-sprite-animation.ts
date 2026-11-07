// 文件: examples/108-02-sprite-animation.ts
// 精灵图集 + 动画帧调度器：按 fps 取帧、循环/单次播放、完成回调
// 目标：动画进度只由时间驱动，与帧率无关——30fps 和 60fps 播放速度一致

import assert from "node:assert";

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 精灵图集：一张大图上按网格切出全部帧，drawImage 九宫格取帧 */
class SpriteSheet {
  constructor(
    public image: string,
    public frames: Frame[],
  ) {}

  /** 按等宽网格生成图集：cols 列 rows 行，每帧 frameW × frameH */
  static grid(image: string, frameW: number, frameH: number, cols: number, rows: number): SpriteSheet {
    const frames: Frame[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        frames.push({ x: c * frameW, y: r * frameH, w: frameW, h: frameH });
      }
    }
    return new SpriteSheet(image, frames);
  }

  frame(i: number): Frame {
    return this.frames[i];
  }
}

/** 动画剪辑：一组帧序号 + 播放速率 + 循环模式 */
class Animation {
  private time = 0;
  private finished = false;
  onComplete: (() => void) | null = null;

  constructor(
    private frameIndices: number[],
    private fps: number,
    private loop = true,
  ) {
    assert.ok(frameIndices.length > 0, "动画至少 1 帧");
    assert.ok(fps > 0, "fps 必须为正");
  }

  /** 推进 dt 秒，返回当前应显示的图集帧序号 */
  update(dt: number): number {
    if (this.finished) return this.frameIndices[this.frameIndices.length - 1];
    this.time += dt;
    const total = this.frameIndices.length / this.fps; // 一轮总时长
    if (this.time >= total) {
      if (this.loop) {
        this.time %= total;
      } else {
        this.finished = true;
        this.onComplete?.();
        return this.frameIndices[this.frameIndices.length - 1];
      }
    }
    const idx = Math.floor(this.time * this.fps) % this.frameIndices.length;
    return this.frameIndices[idx];
  }

  get isFinished(): boolean {
    return this.finished;
  }
}

function runAssertions() {
  // ---------- 测试 1：网格图集切帧 ----------
  const sheet = SpriteSheet.grid("hero.png", 32, 32, 4, 2); // 4 列 2 行共 8 帧
  assert.equal(sheet.frames.length, 8);
  assert.deepEqual(sheet.frame(5), { x: 32, y: 32, w: 32, h: 32 }); // 第 2 行第 2 列
  console.log("[1/4] 图集切帧 OK:", JSON.stringify(sheet.frame(5)));

  // ---------- 测试 2：循环动画按时间取帧 ----------
  const walk = new Animation([0, 1, 2, 3], 8, true); // 8fps 循环
  assert.equal(walk.update(0), 0);
  assert.equal(walk.update(1 / 8), 1); // 0.125s → 第 1 帧
  assert.equal(walk.update(1 / 8), 2); // 0.25s → 第 2 帧
  walk.update(1 / 8); // → 3
  assert.equal(walk.update(1 / 8), 0); // 0.5s 一轮结束，回绕到 0
  console.log("[2/4] 循环动画 OK");

  // ---------- 测试 3：单次动画停在末帧并回调 ----------
  const die = new Animation([4, 5, 6, 7], 8, false);
  let completed = 0;
  die.onComplete = () => completed++;
  die.update(0.1); // 第 1 帧区间
  die.update(0.5); // 直接越过一轮（总时长 0.5s）→ 结束
  assert.equal(completed, 1);
  assert.ok(die.isFinished);
  assert.equal(die.update(1), 7); // 结束后永远停在末帧
  assert.equal(completed, 1, "回调只触发一次");
  console.log("[3/4] 单次动画 OK, 停留帧:", die.update(0));

  // ---------- 测试 4：帧率无关——两种采样粒度同刻同帧 ----------
  const a = new Animation([0, 1, 2, 3, 4, 5, 6, 7], 8, true);
  const b = new Animation([0, 1, 2, 3, 4, 5, 6, 7], 8, true);
  for (let i = 0; i < 20; i++) a.update(1 / 60); // 60fps 喂 0.333s
  for (let i = 0; i < 10; i++) b.update(1 / 30); // 30fps 喂 0.333s
  const fa = a.update(0);
  const fb = b.update(0);
  assert.ok(Math.abs(fa - fb) <= 1, `帧率无关性: ${fa} vs ${fb}`);
  console.log("[4/4] 帧率无关 OK, 60fps 帧:", fa, "30fps 帧:", fb);

  console.log("\n✅ 108-02 精灵动画帧调度器 全部断言通过");
}

runAssertions();
