// 文件: examples/129-03-sortable-reorder.ts
// 129.4 可排序列表的领域模型：稳定 id、禁用项、分组拖入规则、键盘排序
// 对照 SortableJS 的 group.pull/put 与 dnd-kit 的 SortableContext 概念。
import assert from "node:assert/strict";

export interface Item {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface GroupRule {
  name: string;
  pull: boolean | "clone"; // 是否允许拖出
  put: boolean;            // 是否允许拖入
  clone?: boolean;         // 拖入时是否复制
}

export interface Board {
  groups: Record<string, Item[]>;
  rules: Record<string, GroupRule>;
}

/** 拖拽是否被允许：源组可 pull、目标组可 put，且元素未禁用 */
export function canDrop(board: Board, itemId: string, from: string, to: string): boolean {
  const item = board.groups[from]?.find((i) => i.id === itemId);
  if (!item || item.disabled) return false;
  if (from === to) return true;
  const src = board.rules[from];
  const dst = board.rules[to];
  if (!src || !dst) return false;
  return src.pull !== false && dst.put === true;
}

/** 在组内移动；跨组时执行 transfer；返回新 board（不可变更新） */
export function moveItem(board: Board, itemId: string, from: string, to: string, toIndex: number): Board {
  if (!canDrop(board, itemId, from, to)) return board;
  const groups = { ...board.groups };
  const src = [...(groups[from] ?? [])];
  const idx = src.findIndex((i) => i.id === itemId);
  if (idx === -1) return board;
  if (from === to) {
    const [moved] = src.splice(idx, 1);
    const clamped = Math.max(0, Math.min(src.length, toIndex));
    src.splice(clamped, 0, moved);
    groups[from] = src;
    return { ...board, groups };
  }
  const [moved] = src.splice(idx, 1);
  const shouldClone = board.rules[from].clone === true;
  if (!shouldClone) groups[from] = src; // clone 时源组保持原样
  const dst = [...(groups[to] ?? [])];
  const cloned = shouldClone ? { ...moved, id: `${moved.id}-copy-${Date.now()}` } : moved;
  dst.splice(Math.max(0, Math.min(dst.length, toIndex)), 0, cloned);
  groups[to] = dst;
  return { ...board, groups };
}

/** 键盘排序：Alt+ArrowUp/Down 在组内上移/下移，跳过禁用项 */
export function keyboardMove(items: readonly Item[], id: string, direction: -1 | 1): Item[] {
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1 || items[idx].disabled) return [...items];
  let target = idx + direction;
  while (target >= 0 && target < items.length && items[target].disabled) target += direction;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

/** 渲染前的 key 稳定性检查：重复 id 会导致拖拽时元素错位 */
export function findDuplicateIds(board: Board): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const items of Object.values(board.groups)) {
    for (const item of items) {
      if (seen.has(item.id)) dup.add(item.id);
      seen.add(item.id);
    }
  }
  return [...dup];
}

// ---------------- 断言 ----------------
const board: Board = {
  groups: {
    todo: [{ id: "1", label: "写方案" }, { id: "2", label: "评审" }, { id: "3", label: "锁定", disabled: true }],
    doing: [{ id: "4", label: "开发" }],
    done: [],
  },
  rules: {
    todo: { name: "todo", pull: true, put: true },
    doing: { name: "doing", pull: true, put: true },
    done: { name: "done", pull: false, put: true }, // 只进不出
  },
};

assert.equal(canDrop(board, "1", "todo", "doing"), true);
assert.equal(canDrop(board, "3", "todo", "doing"), false, "禁用项不可拖");
assert.equal(canDrop(board, "4", "doing", "done"), true);
assert.equal(canDrop(board, "1", "todo", "done"), true);

const moved = moveItem(board, "1", "todo", "doing", 1);
assert.deepEqual(moved.groups.todo.map((i) => i.id), ["2", "3"]);
assert.deepEqual(moved.groups.doing.map((i) => i.id), ["4", "1"]);
assert.deepEqual(board.groups.todo.map((i) => i.id), ["1", "2", "3"], "原 board 不变");

// 组内移动
const reordered = moveItem(board, "2", "todo", "todo", 0);
assert.deepEqual(reordered.groups.todo.map((i) => i.id), ["2", "1", "3"]);

// 只进不出
const blocked = moveItem(board, "4", "done", "todo", 0);
assert.equal(blocked, board, "done 不允许 pull");

// clone 规则
const cloneBoard: Board = {
  groups: { palette: [{ id: "btn", label: "按钮" }], canvas: [] },
  rules: { palette: { name: "palette", pull: "clone", put: false, clone: true }, canvas: { name: "canvas", pull: true, put: true } },
};
const cloned = moveItem(cloneBoard, "btn", "palette", "canvas", 0);
assert.equal(cloned.groups.palette.length, 1, "clone 保留源元素");
assert.equal(cloned.groups.canvas.length, 1);
assert.notEqual(cloned.groups.canvas[0].id, "btn", "克隆体使用新 id");

// 键盘排序跳过禁用项
const items: Item[] = [{ id: "a", label: "A" }, { id: "b", label: "B", disabled: true }, { id: "c", label: "C" }];
assert.deepEqual(keyboardMove(items, "a", 1).map((i) => i.id), ["c", "b", "a"]);
assert.deepEqual(keyboardMove(items, "b", 1).map((i) => i.id), ["a", "b", "c"], "禁用项不可移动");

// 重复 id
assert.deepEqual(findDuplicateIds({ ...board, groups: { ...board.groups, done: [{ id: "1", label: "重复" }] } }), ["1"]);

console.log("✓ 129-03 分组规则、不可变移动、clone、键盘排序断言全部通过");
