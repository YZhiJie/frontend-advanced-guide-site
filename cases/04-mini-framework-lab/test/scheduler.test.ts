// 文件: cases/04-mini-framework-lab/test/scheduler.test.ts
// ============ 优先级调度 + 批量 flush 回归 ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { schedule, __resetScheduler, lastRunRecords, waitForIdle } from "../src/scheduler.js"

test.beforeEach(() => {
    __resetScheduler()
})

// ============================================================
// 基础：normal 优先级按入队顺序跑
// ============================================================

test("normal 优先级按入队顺序执行", async () => {
    const order: string[] = []
    schedule(() => order.push("a"))
    schedule(() => order.push("b"))
    schedule(() => order.push("c"))
    await waitForIdle()
    assert.deepEqual(order, ["a", "b", "c"])
})

// ============================================================
// 优先级：high 在 normal 之前
// ============================================================

test("high 优先级在 normal 之前执行", async () => {
    const order: string[] = []
    schedule(() => order.push("n1"), "normal")
    schedule(() => order.push("n2"), "normal")
    schedule(() => order.push("h1"), "high")
    schedule(() => order.push("h2"), "high")
    await waitForIdle()
    // high 应该在 normal 之前
    const hIdx = [order.indexOf("h1"), order.indexOf("h2")]
    const nIdx = [order.indexOf("n1"), order.indexOf("n2")]
    assert.ok(Math.min(...hIdx) < Math.max(...nIdx), `顺序不对: ${order.join(",")}`)
})

test("normal 在 low 之前执行", async () => {
    const order: string[] = []
    schedule(() => order.push("l"), "low")
    schedule(() => order.push("n"), "normal")
    await waitForIdle(100)
    assert.equal(order[0], "n", `normal 应在 low 之前，实际: ${order.join(",")}`)
})

test("high、normal、low 全部按优先级执行", async () => {
    const order: string[] = []
    schedule(() => order.push("l"), "low")
    schedule(() => order.push("h"), "high")
    schedule(() => order.push("n"), "normal")
    await waitForIdle(100)
    assert.equal(order[0], "h")
    assert.equal(order[1], "n")
    assert.equal(order[2], "l")
})

// ============================================================
// 去重
// ============================================================

test("相同 id 会覆盖，不重复执行", async () => {
    const calls: string[] = []
    schedule(() => calls.push("v1"), "normal", "id1")
    schedule(() => calls.push("v2"), "normal", "id1")
    await waitForIdle()
    assert.equal(calls.length, 1)
    assert.equal(calls[0], "v2")
})

test("不同 id 互不影响", async () => {
    const calls: string[] = []
    schedule(() => calls.push("a"), "normal", "id1")
    schedule(() => calls.push("b"), "normal", "id2")
    await waitForIdle()
    assert.deepEqual(calls, ["a", "b"])
})

// ============================================================
// 错误处理
// ============================================================

test("单个任务抛错不影响其他任务执行", async () => {
    const order: string[] = []
    schedule(() => {
        order.push("ok1")
    })
    schedule(() => {
        throw new Error("boom")
    })
    schedule(() => {
        order.push("ok2")
    })
    await waitForIdle()
    assert.deepEqual(order, ["ok1", "ok2"])
})

// ============================================================
// lastRunRecords 记录
// ============================================================

test("lastRunRecords 能记录所有执行过的任务", async () => {
    schedule(() => {}, "high")
    schedule(() => {}, "normal")
    schedule(() => {}, "low")
    await waitForIdle(100)
    assert.ok(lastRunRecords.length >= 3)
    const priorities = lastRunRecords.map((r) => r.priority)
    assert.ok(priorities.includes("high"))
    assert.ok(priorities.includes("normal"))
    assert.ok(priorities.includes("low"))
})
