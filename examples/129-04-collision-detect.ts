// 文件: examples/129-04-collision-detect.ts
// 129.5 命中测试：closestCenter、pointerWithin、rectIntersection 的差异
// 拖到哪个位置，决定「排序结果」；命中算法选错，用户会觉得「不跟手」。
import assert from "node:assert/strict";

export interface Rect { left: number; top: number; width: number; height: number }
export interface Point { x: number; y: number }
export interface CollisionEntry { id: string; rect: Rect; disabled?: boolean }

const center = (r: Rect): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 中心点最近：稳定、适合等高列表；嵌套容器时可能选到父容器 */
export function closestCenter(pointer: Point, entries: CollisionEntry[]): string | null {
  let best: { id: string; d: number } | null = null;
  for (const e of entries) {
    if (e.disabled) continue;
    const d = distance(pointer, center(e.rect));
    if (!best || d < best.d) best = { id: e.id, d };
  }
  return best?.id ?? null;
}

/** 指针是否落在矩形内；多个命中时取面积最小（最具体）的容器 */
export function pointerWithin(pointer: Point, entries: CollisionEntry[]): string | null {
  const hits = entries.filter(
    (e) => !e.disabled && pointer.x >= e.rect.left && pointer.x <= e.rect.left + e.rect.width &&
      pointer.y >= e.rect.top && pointer.y <= e.rect.top + e.rect.height,
  );
  if (hits.length === 0) return null;
  return hits.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0].id;
}

/** 矩形相交面积最大；面积相同时取容器更小（更具体）的那个 */
export function rectIntersection(drag: Rect, entries: CollisionEntry[]): string | null {
  const overlap = (r: Rect): number => Math.max(0, Math.min(drag.left + drag.width, r.left + r.width) - Math.max(drag.left, r.left)) *
    Math.max(0, Math.min(drag.top + drag.height, r.top + r.height) - Math.max(drag.top, r.top));
  const hits = entries
    .filter((e) => !e.disabled)
    .map((e) => ({ id: e.id, a: overlap(e.rect), container: e.rect.width * e.rect.height }))
    .filter((x) => x.a > 0)
    .sort((x, y) => y.a - x.a || x.container - y.container);
  return hits[0]?.id ?? null;
}

// ---------------- 断言 ----------------
const entries: CollisionEntry[] = [
  { id: "col", rect: { left: 0, top: 0, width: 300, height: 300 } },
  { id: "a", rect: { left: 0, top: 0, width: 100, height: 50 } },
  { id: "b", rect: { left: 0, top: 50, width: 100, height: 50 } },
  { id: "c", rect: { left: 0, top: 100, width: 100, height: 50 }, disabled: true },
];

// 指针在 b 中心：三种算法都应选 b（b 比 col 面积小）
assert.equal(closestCenter({ x: 50, y: 75 }, entries), "b");
assert.equal(pointerWithin({ x: 50, y: 75 }, entries), "b");
assert.equal(rectIntersection({ left: 0, top: 60, width: 50, height: 30 }, entries), "b");

// 指针在空白区域（仍在 col 内）：closestCenter 仍会选最近的 a/b，pointerWithin 返回 col
assert.equal(closestCenter({ x: 250, y: 250 }, entries), "col");
assert.equal(pointerWithin({ x: 250, y: 250 }, entries), "col");
assert.equal(pointerWithin({ x: 999, y: 999 }, entries), null);

// 禁用项永远不参与
assert.equal(closestCenter({ x: 50, y: 125 }, entries), "b", "禁用 c 不参与，退而选最近的 b");
assert.equal(pointerWithin({ x: 50, y: 125 }, entries), "col", "c 被禁用，只剩 col");

// 嵌套容器：pointerWithin 取面积最小者（最具体）
assert.equal(pointerWithin({ x: 20, y: 20 }, entries), "a");

// 无命中
assert.equal(rectIntersection({ left: 500, top: 500, width: 10, height: 10 }, entries), null);

console.log("✓ 129-04 三种命中算法、禁用项与嵌套容器断言全部通过");
