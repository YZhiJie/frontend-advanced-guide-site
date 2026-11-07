// 文件: examples/54-01-mini-timeline.ts
// ============ 迷你 GSAP 时间线:标签、相对定位、缓动与 seek ============
// 设计要点:
// 1) 时间线不是「一堆 setTimeout」,而是「一条可 seek 的时间轴」——任何时刻都能算出准确值;
// 2) GSAP 的位置参数("<" 表示与上一个动画同时开始,"+=x" 表示相对结尾延后)是编排的关键;
// 3) 缓动函数必须是纯函数:输入 0~1,输出 0~1,才能被测试与复用。

type EaseName = "linear" | "outQuad" | "inOutQuad";

const EASES: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

interface Tween {
  target: string;
  from: number;
  to: number;
  start: number;
  duration: number;
  ease: EaseName;
}

type Position = number | "<" | `+=${number}`;

class MiniTimeline {
  duration = 0;
  private tweens: Tween[] = [];
  private labels = new Map<string, number>();
  private lastStart = 0;

  to(
    target: string,
    from: number,
    to: number,
    opts: { duration?: number; at?: Position; ease?: EaseName } = {},
  ): this {
    const duration = opts.duration ?? 1;
    const start =
      opts.at === undefined
        ? this.duration
        : opts.at === "<"
          ? this.lastStart
          : typeof opts.at === "number"
            ? opts.at
            : this.duration + Number(opts.at.slice(2));

    this.tweens.push({ target, from, to, start, duration, ease: opts.ease ?? "outQuad" });
    this.lastStart = start;
    this.duration = Math.max(this.duration, start + duration);
    return this;
  }

  label(name: string, at: number = this.duration): this {
    this.labels.set(name, at);
    return this;
  }

  /** 任意时刻的状态:同一目标后加入的 tween 覆盖先前的值 */
  seek(time: number): Record<string, number> {
    const state: Record<string, number> = {};
    for (const tw of this.tweens) {
      if (time < tw.start) continue; // 尚未开始的 tween 不应覆盖当前值
      const local = (time - tw.start) / tw.duration;
      const progress = Math.min(1, Math.max(0, local));
      const eased = EASES[tw.ease](progress);
      state[tw.target] = tw.from + (tw.to - tw.from) * eased;
    }
    return state;
  }

  labelTime(name: string): number | undefined {
    return this.labels.get(name);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const tl = new MiniTimeline();
tl
  .to("box", 0, 100, { duration: 1, ease: "outQuad" })
  .to("opacity", 0, 1, { duration: 1, at: "<", ease: "linear" })
  .label("mid", 0.5)
  .to("box", 100, 200, { duration: 1, ease: "linear" });

console.log("时间线总时长:", tl.duration, "| mid 标签:", tl.labelTime("mid"));
assert(tl.duration === 2, "总时长应为两段各 1s");

// ---------------- 同一时刻:两个 tween 并行 ----------------
const at05 = tl.seek(0.5);
console.log("t=0.5:", at05);
assert(Math.abs(at05.box - 75) < 1e-6, "outQuad 在 0.5 处应为 75");
assert(Math.abs(at05.opacity - 0.5) < 1e-6, "linear 在 0.5 处应为 0.5");

// ---------------- 第一段结束 ----------------
const at1 = tl.seek(1);
console.log("t=1.0:", at1);
assert(at1.box === 100 && at1.opacity === 1, "第一段结束值应为终值");

// ---------------- 第二段进行中 ----------------
const at15 = tl.seek(1.5);
console.log("t=1.5:", at15);
assert(at15.box === 150, "第二段线性中点应为 150");

// ---------------- 超出总时长 ----------------
const at3 = tl.seek(3);
assert(at3.box === 200, "超过总时长应停在终值");

// ---------------- 相对定位 += ----------------
const tl2 = new MiniTimeline();
tl2.to("a", 0, 1, { duration: 0.5 });
tl2.to("b", 0, 1, { duration: 0.5, at: "+=0.2" });
console.log("相对定位总时长:", tl2.duration);
assert(tl2.duration === 1.2, "b 应在 a 结束后再延后 0.2s");

// ---------------- 缓动函数边界 ----------------
for (const name of Object.keys(EASES) as EaseName[]) {
  assert(EASES[name](0) === 0 && EASES[name](1) === 1, `${name} 必须满足 f(0)=0, f(1)=1`);
}

console.log("\n时间线通过:并行、顺序、标签、相对定位、超出终值、缓动边界均有确定行为。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};
