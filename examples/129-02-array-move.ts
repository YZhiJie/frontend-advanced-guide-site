// 文件: examples/129-02-array-move.ts
// 129.3 排序的数学：arrayMove 的索引语义、多选移动、插入位置归一化
// 拖拽排序 80% 的 bug 来自「移除前后索引没换算」。
import assert from "node:assert/strict";

/** 单元素移动：先删除 from，再插入到 to（to 是移除后的目标下标） */
export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...items];
  if (from < 0 || from >= items.length) throw new RangeError(`from 越界：${from}`);
  if (to < 0 || to >= items.length) throw new RangeError(`to 越界：${to}`);
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 多选移动：把 indices 指向的元素整体移动到 target 前（保持原相对顺序） */
export function moveMany<T>(items: readonly T[], indices: readonly number[], target: number): T[] {
  const selected = new Set(indices);
  if (selected.size === 0) return [...items];
  const moving = items.filter((_, i) => selected.has(i));
  const rest = items.filter((_, i) => !selected.has(i));
  // target 是原数组下标：统计 target 之前被移走的元素个数，换算成 rest 中的插入点
  const before = indices.filter((i) => i < target).length;
  const insertAt = Math.max(0, Math.min(rest.length, target - before));
  return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
}

/**
 * 索引语义提醒：
 * - dnd-kit 的 arrayMove(from, to) 中 to 是「移除后」的最终下标，直接用即可；
 * - SortableJS 的 onEnd 给出的 oldIndex/newIndex 也是移除后的语义；
 * - 若你的命中算法返回的是「插入到该元素之前」的原始下标，向下拖时必须减 1。
 * 三种口径不要混用，否则就会出现「拖到下一格却跳过一格」。
 */

/** 跨容器移动：返回源容器与目标容器的新数组，以及目标插入下标 */
export function transfer<T>(
  source: readonly T[],
  target: readonly T[],
  from: number,
  insertAt: number,
): { source: T[]; target: T[] } {
  const src = [...source];
  const [moved] = src.splice(from, 1);
  const tgt = [...target];
  tgt.splice(Math.max(0, Math.min(tgt.length, insertAt)), 0, moved);
  return { source: src, target: tgt };
}

// ---------------- 断言 ----------------
const list = ["a", "b", "c", "d"];
assert.deepEqual(arrayMove(list, 0, 2), ["b", "c", "a", "d"]);
assert.deepEqual(arrayMove(list, 3, 0), ["d", "a", "b", "c"]);
assert.deepEqual(arrayMove(list, 1, 1), list);
assert.deepEqual(list, ["a", "b", "c", "d"], "不得原地修改");
assert.throws(() => arrayMove(list, -1, 0), RangeError);

// 向下拖：from=1、最终下标 3，结果是 b 落到 d 之后
assert.deepEqual(arrayMove(["a", "b", "c", "d"], 1, 3), ["a", "c", "d", "b"]);
assert.deepEqual(arrayMove(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);

// 多选移动：把 b、d 移到 c 之前
assert.deepEqual(moveMany(["a", "b", "c", "d", "e"], [1, 3], 2), ["a", "b", "d", "c", "e"]);
// 移到末尾
assert.deepEqual(moveMany(["a", "b", "c", "d"], [1, 2], 4), ["a", "d", "b", "c"]);
assert.deepEqual(moveMany(["a", "b"], [], 1), ["a", "b"]);

// 跨容器
const r = transfer(["a", "b", "c"], ["x", "y"], 1, 1);
assert.deepEqual(r.source, ["a", "c"]);
assert.deepEqual(r.target, ["x", "b", "y"]);
const r2 = transfer(["a"], ["x"], 0, 99);
assert.deepEqual(r2.target, ["x", "a"], "插入下标越界时钳制到末尾");

console.log("✓ 129-02 排序索引、多选移动与跨容器断言全部通过");
