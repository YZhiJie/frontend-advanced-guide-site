// 文件: cases/04-mini-framework-lab/test/vdom.test.ts
// ============ VNode 创建 + diff + patch 回归（node:test） ============

import { test } from "node:test";
import assert from "node:assert/strict";
import { h, isSameVNodeType, diff, collectDOMCommands } from "../src/vdom.js";

// ============================================================
// h() 基础
// ============================================================

test("h 创建 tag + props + children 的 VNode", () => {
  const v = h("div", { id: "root" }, "hello");
  assert.equal(v.type, "div");
  assert.equal(v.props!.id, "root");
  assert.equal(v.children.length, 1);
  assert.equal(v.children[0].type, "TEXT");
  assert.equal(v.children[0].text, "hello");
});

test("h 自动过滤 null/undefined/boolean，拍平数组", () => {
  const v = h(
    "ul",
    null,
    h("li", null, "a"),
    null,
    false,
    [h("li", null, "b"), h("li", null, "c")],
    42,
  );
  assert.equal(v.children.length, 4);
  assert.equal(v.children[0].type, "li");
  assert.equal(v.children[3].type, "TEXT");
  assert.equal(v.children[3].text, "42");
});

test("h 把 key 从 props 中取出放到 vnode.key", () => {
  const v = h("li", { key: "a", class: "x" }, "text");
  assert.equal(v.key, "a");
  assert.equal(v.props!.key, undefined);
  assert.equal(v.props!.class, "x");
});

// ============================================================
// isSameVNodeType
// ============================================================

test("isSameVNodeType 比较 type + key", () => {
  const a = h("div", null, "a");
  const b = h("div", null, "b");
  const c = h("span", null, "c");
  const d = h("div", { key: "x" }, "d");
  const e = h("div", { key: "x" }, "e");
  assert.equal(isSameVNodeType(a, b), true);
  assert.equal(isSameVNodeType(a, c), false);
  assert.equal(isSameVNodeType(d, e), true);
  assert.equal(isSameVNodeType(a, d), false); // key 不同
  assert.equal(isSameVNodeType(null, a), false);
});

// ============================================================
// diff：基础
// ============================================================

test("diff 从无到有 → rootOp CREATE", () => {
  const newNode = h("div", { id: "a" }, "hi");
  const result = diff(null, newNode);
  assert.notEqual(result.rootOp, null);
  assert.equal(result.rootOp!.op, "CREATE");
  assert.equal(result.childrenOps.length, 1); // "hi" 文本节点
});

test("diff 根节点类型变了 → rootOp REPLACE", () => {
  const old = h("div", null, "a");
  const next = h("span", null, "a");
  const result = diff(old, next);
  assert.equal(result.rootOp!.op, "REPLACE");
});

test("diff 同类型无 key → 原地更新", () => {
  const old = h("div", { id: "old" }, "x");
  const next = h("div", { id: "new" }, "x");
  const result = diff(old, next);
  assert.equal(result.rootOp, null);
  // prop 更新应被检测
  const hasIdUpdate = result.propOps.some(
    (op) =>
      op.op === "UPDATE_PROPS" &&
      "id" in (op.newProps as Record<string, unknown>),
  );
  assert.equal(hasIdUpdate, true);
});

test("diff 文本子节点 type 相同也会走 replace（TEXT 同类型）", () => {
  const old = h("p", null, "hello");
  const next = h("p", null, "world");
  const result = diff(old, next);
  assert.equal(result.rootOp, null);
  // 子节点文本不同：child 的 diff 会在 childrenOps 里产生 UPDATE
  const childDiff = result.childrenOps[0];
  assert.equal(childDiff.rootOp, null); // TEXT type 相同
});

// ============================================================
// diff：同层 keyed list
// ============================================================

test("diff keyed list 简单重排：先创建节点 + 标记移动", () => {
  const old = h("ul", null, [
    h("li", { key: "a" }, "a"),
    h("li", { key: "b" }, "b"),
    h("li", { key: "c" }, "c"),
  ]);
  const next = h("ul", null, [
    h("li", { key: "c" }, "c"),
    h("li", { key: "a" }, "a"),
    h("li", { key: "b" }, "b"),
  ]);
  const result = diff(old, next);
  assert.equal(result.rootOp, null);
  // 三个节点都应该有对应 childrenOps
  assert.equal(result.childrenOps.length, 3);
  // 没有新建节点
  const creates = result.childrenOps.filter((c) => c.rootOp?.op === "CREATE");
  assert.equal(creates.length, 0);
});

test("diff keyed list 新增 + 删除", () => {
  const old = h("ul", null, [
    h("li", { key: "a" }, "a"),
    h("li", { key: "b" }, "b"),
  ]);
  const next = h("ul", null, [
    h("li", { key: "b" }, "b"),
    h("li", { key: "c" }, "c"),
  ]);
  const result = diff(old, next);
  const inserts = result.childrenOps.filter((c) => c.rootOp?.op === "INSERT");
  const removes = result.childrenOps.filter((c) => c.rootOp?.op === "REMOVE");
  assert.ok(inserts.length >= 1, "应至少有一个 INSERT（c）");
  assert.ok(removes.length >= 1, "应至少有一个 REMOVE（a）");
});

test("diff 无 key 的 list 走同索引 diff", () => {
  const old = h("ul", null, [h("li", null, "a"), h("li", null, "b")]);
  const next = h("ul", null, [
    h("li", null, "b"),
    h("li", null, "a"),
    h("li", null, "c"),
  ]);
  const result = diff(old, next);
  assert.equal(result.childrenOps.length, 3); // 最大长度
  // 第三个应该是 CREATE
  const creates = result.childrenOps.filter((c) => c.rootOp?.op === "CREATE");
  assert.ok(creates.length >= 1);
});

// ============================================================
// collectDOMCommands
// ============================================================

test("collectDOMCommands 把 CREATE / INSERT / SETPROP 展开成命令列表", () => {
  const v = h("div", { id: "root", class: "x" }, "hello");
  const patches = [diff(null, v)];
  const cmds = collectDOMCommands(patches, "body");
  // 至少要有 create + setProp×2 + insert + 文本节点 create
  assert.ok(cmds.length >= 5, cmds.map((c) => c.kind).join(","));
  const kinds = cmds.map((c) => c.kind);
  assert.ok(kinds.includes("create"));
  assert.ok(kinds.includes("setProp"));
  assert.ok(kinds.includes("insert"));
});

test("collectDOMCommands 处理空 diff 不产生命令", () => {
  const v = h("div", null, "a");
  const same = diff(v, v); // 完全相同的节点
  // prop 没变化时，propOps 为空；但同类型 + 无 change 也可能什么都没有
  const cmds = collectDOMCommands([same], "root");
  // 不会有 CREATE / REPLACE
  assert.ok(!cmds.some((c) => c.kind === "create"));
});

test("diff 嵌套结构：多层 children 能正确递归", () => {
  const old = h("div", null, [h("section", null, [h("p", null, "x")])]);
  const next = h("div", null, [h("section", null, [h("p", null, "y")])]);
  const result = diff(old, next);
  assert.equal(result.rootOp, null);
  // 第一层 section 应该在 childrenOps 里且有自己的 childrenOps
  const sectionDiff = result.childrenOps[0];
  assert.ok(sectionDiff !== undefined);
  assert.ok(Array.isArray(sectionDiff.childrenOps));
});

// ============================================================
// prop diff
// ============================================================

test("diff props 删除/新增/修改都被检测", () => {
  const old = h("div", { a: 1, b: 2 }, "x");
  const next = h("div", { b: 3, c: 4 }, "x");
  const result = diff(old, next);
  const keysInOps = new Set<string>();
  for (const op of result.propOps) {
    if (op.op === "UPDATE_PROPS") {
      Object.keys(op.newProps as Record<string, unknown>).forEach((k) =>
        keysInOps.add(k),
      );
    }
  }
  assert.ok(keysInOps.has("a"), "a 应出现在删除操作里");
  assert.ok(keysInOps.has("b"), "b 应出现在更新操作里");
  assert.ok(keysInOps.has("c"), "c 应出现在新增操作里");
});
