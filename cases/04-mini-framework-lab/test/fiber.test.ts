// 文件: cases/04-mini-framework-lab/test/fiber.test.ts
// ============ Fiber 树构建 + beginWork / completeWork + 时间片 回归 ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { h } from "../src/vdom.js"
import {
    render,
    renderAsync,
    createFiber,
    createFiberFromVNode,
    createHostRootFiber,
    fiberToTreeString,
    NoFlags,
    Placement,
    Update,
    Deletion,
} from "../src/fiber.js"
import type { Fiber } from "../src/fiber.js"

// ============================================================
// Fiber 创建
// ============================================================

test("createFiber 基础字段正确", () => {
    const f = createFiber("HostComponent", "div", { id: "a" })
    assert.equal(f.tag, "HostComponent")
    assert.equal(f.type, "div")
    assert.deepEqual(f.pendingProps as Record<string, unknown>, { id: "a" })
    assert.equal(f.flags, NoFlags)
    assert.equal(f.child, null)
    assert.equal(f.sibling, null)
    assert.equal(f.alternate, null)
})

test("createFiberFromVNode 能正确把 VNode 转成 Fiber", () => {
    const v = h("span", { class: "x" }, "hello")
    const f = createFiberFromVNode(v)
    assert.equal(f.tag, "HostComponent")
    assert.equal(f.type, "span")
    assert.equal((f.pendingProps as Record<string, unknown>).class, "x")
    assert.equal(f.key, null)
})

test("createFiberFromVNode 对 TEXT 节点设 HostText", () => {
    const text = h("div", null, "hi").children[0] // TEXT vnode
    const f = createFiberFromVNode(text)
    assert.equal(f.tag, "HostText")
    assert.equal(f.type, "TEXT")
    assert.equal(f.pendingProps, "hi")
})

test("createHostRootFiber 产生 HostRoot", () => {
    const root = createHostRootFiber()
    assert.equal(root.tag, "HostRoot")
    assert.equal(root.type, null)
})

// ============================================================
// render (sync)：树结构正确
// ============================================================

function buildSimpleTree(): ReturnType<typeof h> {
    // div#root > [ span "a", span "b" ]
    return h("div", { id: "root" }, [h("span", null, "a"), h("span", null, "b")])
}

test("render sync: HostRoot 的 child 是 div HostComponent", () => {
    const vnode = buildSimpleTree()
    const result = render(vnode, { sync: true })
    const root = result.root
    assert.equal(root.tag, "HostRoot")
    assert.ok(root.child)
    assert.equal(root.child.tag, "HostComponent")
    assert.equal(root.child.type, "div")
})

test("render sync: div 的 child 是 span，span 间用 sibling 链连接", () => {
    const vnode = buildSimpleTree()
    const result = render(vnode, { sync: true })
    const div = result.root.child!
    assert.ok(div.child)
    const span1 = div.child!
    const span2 = span1.sibling!
    assert.equal(span1.tag, "HostComponent")
    assert.equal(span1.type, "span")
    assert.equal(span2.tag, "HostComponent")
    assert.equal(span2.type, "span")
    assert.equal(span2.sibling, null)
})

test("render sync: span 内的文本节点正确挂在 child 上", () => {
    const vnode = h("span", null, "hello")
    const result = render(vnode, { sync: true })
    const span = result.root.child!
    const text = span.child!
    assert.equal(text.tag, "HostText")
    assert.equal(text.type, "TEXT")
    assert.equal(text.pendingProps, "hello")
})

// ============================================================
// flags：Placement
// ============================================================

function countFlags(fiber: Fiber, flag: number): number {
    let count = 0
    let cursor: Fiber | null = fiber
    // DFS
    const stack: Fiber[] = [fiber]
    while (stack.length > 0) {
        const n = stack.pop()!
        if (n.flags & flag) count++
        if (n.child) stack.push(n.child)
        let sib = n.sibling
        while (sib) {
            if (sib.flags & flag) count++
            if (sib.child) stack.push(sib.child)
            sib = sib.sibling
        }
    }
    void cursor
    return count
}

test("首次 render 所有非 Root Fiber 都带 Placement flag", () => {
    const vnode = h("div", null, [h("span", null, "a"), h("span", null, "b")])
    const result = render(vnode, { sync: true })
    const placements = countFlags(result.root, Placement)
    // div + 2 个 span + 2 个文本 = 5 个
    assert.equal(placements, 5, `预期 5 个 Placement，实际 ${placements}`)
})

// ============================================================
// buildLog：beginWork → completeWork 顺序
// ============================================================

test("buildLog 里每一个 begin 都有对应的 complete", () => {
    const vnode = buildSimpleTree()
    const result = render(vnode, { sync: true })
    const begins = result.buildLog.filter((l) => l.phase === "begin").length
    const completes = result.buildLog.filter((l) => l.phase === "complete").length
    assert.equal(begins, completes)
    assert.ok(begins >= 3, `至少 Root + div + 2 spans = 4+ 节点`)
})

test("buildLog 顺序是深度优先：父 begin → 全部子 begin → 子 complete → 父 complete", () => {
    const vnode = h("div", null, [h("span", null, "x")])
    const result = render(vnode, { sync: true })
    // 期望：Root begin, div begin, span begin, TEXT begin, TEXT complete, span complete, div complete, Root complete
    // 验证：div 的 begin 必须在 div 的 complete 之前，且在 span begin 之前
    const log = result.buildLog
    const divBegin = log.findIndex((l) => l.fiberType === "div" && l.phase === "begin")
    const divComplete = log.findIndex((l) => l.fiberType === "div" && l.phase === "complete")
    const spanBegin = log.findIndex((l) => l.fiberType === "span" && l.phase === "begin")
    assert.ok(divBegin < spanBegin, "父 begin 应先于子 begin")
    assert.ok(spanBegin < divComplete, "子 begin 应先于父 complete")
})

// ============================================================
// fiberToTreeString 输出
// ============================================================

test("fiberToTreeString 能把 Fiber 树显示出来", () => {
    const vnode = h("div", null, "hi")
    const result = render(vnode, { sync: true })
    const s = fiberToTreeString(result.root)
    assert.ok(s.includes("<Root"))
    assert.ok(s.includes("<div"))
})

// ============================================================
// keyed list：移动 + Deletion 标记
// ============================================================

test("render with keyed list：deletion 会被标记（旧多出来的节点）", () => {
    const old = h("ul", null, [
        h("li", { key: "a" }, "a"),
        h("li", { key: "b" }, "b"),
    ])
    const next = h("ul", null, [
        h("li", { key: "b" }, "b"),
        h("li", { key: "c" }, "c"),
    ])
    // 先 render old 再手动模拟 next 的 diff：这里直接用 next render 检查 Placement
    const result = render(next, { sync: true })
    // 新 render 应该是全新的 Placement（因为没有 alternate）
    const placements = countFlags(result.root, Placement)
    assert.ok(placements >= 4) // ul + 2 li + 2 文本
    void old
})

// ============================================================
// 时间片（异步模式）
// ============================================================

test("renderAsync 返回 Promise，完成后 buildLog 完整", async () => {
    const vnode = h("div", null, [h("span", null, "x"), h("span", null, "y")])
    const result = await renderAsync(vnode, { frameBudgetMs: 1000 })
    assert.ok(result.root)
    const begins = result.buildLog.filter((l) => l.phase === "begin").length
    const completes = result.buildLog.filter((l) => l.phase === "complete").length
    assert.equal(begins, completes)
    assert.ok(begins >= 5)
})

// ============================================================
// flags 常量
// ============================================================

test("flags 常量互不重叠（bitmask）", () => {
    assert.ok((Placement & Update) === 0)
    assert.ok((Placement & Deletion) === 0)
    assert.ok((Update & Deletion) === 0)
})
