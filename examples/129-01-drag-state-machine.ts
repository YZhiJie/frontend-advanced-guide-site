// 文件: examples/129-01-drag-state-machine.ts
// 129.2 原生拖拽的核心：指针状态机 + 4px 阈值 + 轴锁定 + 边界钳制
// 不依赖 DOM，纯状态机，可在 Node 中硬断言；真实项目把输出接到 transform。
import assert from "node:assert/strict";

export interface Point { x: number; y: number }
export interface Rect { left: number; top: number; width: number; height: number }
export type Axis = "both" | "x" | "y";

export interface DragConfig {
  threshold?: number;   // 超过多少 px 才算拖拽（防止点击被误判）
  axis?: Axis;          // 锁定方向，如只允许水平排序
  bounds?: Rect;        // 可拖动范围（元素左上角）
  size?: { width: number; height: number };
}

export type DragState =
  | { phase: "idle" }
  | { phase: "pressed"; start: Point; pointerId: number }
  | { phase: "dragging"; start: Point; current: Point; offset: Point }
  | { phase: "cancelled"; reason: string };

export class DragMachine {
  private state: DragState = { phase: "idle" };
  private config: Required<Omit<DragConfig, "bounds" | "size">> & Pick<DragConfig, "bounds" | "size">;

  constructor(config: DragConfig = {}) {
    this.config = {
      threshold: config.threshold ?? 4,
      axis: config.axis ?? "both",
      bounds: config.bounds,
      size: config.size,
    };
  }

  get current(): DragState {
    return this.state;
  }

  pointerDown(start: Point, pointerId = 1): void {
    this.state = { phase: "pressed", start, pointerId };
  }

  pointerMove(current: Point, pointerId = 1): DragState {
    if (this.state.phase !== "pressed" && this.state.phase !== "dragging") return this.state;
    if (this.state.phase === "pressed") {
      const dx = current.x - this.state.start.x;
      const dy = current.y - this.state.start.y;
      if (Math.hypot(dx, dy) < this.config.threshold) return this.state; // 阈值内仍视为点击
      if (this.state.pointerId !== pointerId) return this.state;           // 多指/多设备隔离
      this.state = { phase: "dragging", start: this.state.start, current, offset: { x: 0, y: 0 } };
    }
    assert.equal(this.state.phase, "dragging");
    const start = this.state.start;
    let offset = { x: current.x - start.x, y: current.y - start.y };
    if (this.config.axis === "x") offset = { x: offset.x, y: 0 };
    if (this.config.axis === "y") offset = { x: 0, y: offset.y };
    offset = this.clamp(offset);
    this.state = { phase: "dragging", start, current, offset };
    return this.state;
  }

  private clamp(offset: Point): Point {
    const { bounds, size } = this.config;
    if (!bounds || !size) return offset;
    // 元素初始位置未知时，用「相对位移」的边界：拖动后左上角不能越过 bounds
    return {
      x: Math.max(-bounds.left, Math.min(bounds.width - size.width, offset.x)) || 0,
      y: Math.max(-bounds.top, Math.min(bounds.height - size.height, offset.y)) || 0,
    };
  }

  pointerUp(): DragState {
    if (this.state.phase === "dragging") {
      const dropped = this.state;
      this.state = { phase: "idle" };
      return dropped; // 调用方用 offset 做排序/落位
    }
    this.state = { phase: "idle" };
    return this.state;
  }

  cancel(reason = "escape"): DragState {
    this.state = { phase: "cancelled", reason };
    return this.state;
  }
}

// ---------------- 断言 ----------------
const m = new DragMachine({ threshold: 4 });
m.pointerDown({ x: 100, y: 100 });
assert.equal(m.current.phase, "pressed");
m.pointerMove({ x: 101, y: 101 }); // 距离 ≈1.41 < 4
assert.equal(m.current.phase, "pressed", "阈值内不进入拖拽");
m.pointerMove({ x: 110, y: 100 });
assert.equal(m.current.phase, "dragging");
assert.deepEqual((m.current as { offset: Point }).offset, { x: 10, y: 0 });

// 轴锁定
const horizontal = new DragMachine({ axis: "x" });
horizontal.pointerDown({ x: 0, y: 0 });
horizontal.pointerMove({ x: 40, y: 999 });
assert.deepEqual((horizontal.current as { offset: Point }).offset, { x: 40, y: 0 });

// 边界钳制：容器 200x200，元素 50x50
const bounded = new DragMachine({ bounds: { left: 0, top: 0, width: 200, height: 200 }, size: { width: 50, height: 50 } });
bounded.pointerDown({ x: 0, y: 0 });
bounded.pointerMove({ x: 999, y: -999 });
assert.deepEqual((bounded.current as { offset: Point }).offset, { x: 150, y: 0 });

// 取消与松开
assert.equal(m.cancel().phase, "cancelled");
m.pointerDown({ x: 0, y: 0 });
m.pointerMove({ x: 50, y: 0 });
assert.equal(m.pointerUp().phase, "dragging", "pointerUp 返回最后一次拖拽状态供落位");
assert.equal(m.current.phase, "idle");

// pointerId 隔离
const multi = new DragMachine();
multi.pointerDown({ x: 0, y: 0 }, 1);
assert.equal(multi.pointerMove({ x: 100, y: 0 }, 2).phase, "pressed", "不同指针不推进状态");

console.log("✓ 129-01 拖拽状态机（阈值/轴锁/边界/取消/多指针）断言全部通过");
