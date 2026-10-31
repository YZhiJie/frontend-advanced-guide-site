// 文件: cases/10-virtual-list-lab/test/virtual-list.test.ts
// ============ 虚拟列表与帧调度回归（node:test + node:assert/strict，全部离线确定） ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { createVirtualList } from "../src/virtual-list.js"
import { createFrameScheduler } from "../src/scheduler.js"
import type { VirtualListApi } from "../src/virtual-list.js"
import type { RafFn } from "../src/scheduler.js"

// ---------- 虚拟列表：定高模式 ----------

test("定高模式：scrollTop=0 时窗口为前 viewport/itemHeight 项", () => {
    const list = createVirtualList({ itemCount: 100, viewportHeight: 100, itemHeight: 20, overscan: 0 })
    assert.deepEqual(list.getRange(), { startIndex: 0, endIndex: 4, offsetY: 0 })
    assert.equal(list.getTotalHeight(), 2000)
})

test("定高模式：滚动到中段，窗口与首项位移正确", () => {
    const list = createVirtualList({ itemCount: 100, viewportHeight: 100, itemHeight: 20, overscan: 0 })
    list.setScrollTop(210)
    assert.deepEqual(list.getRange(), { startIndex: 10, endIndex: 15, offsetY: 200 })
})

test("overscan：顶部夹紧，startIndex 不越过首项", () => {
    const list = createVirtualList({ itemCount: 100, viewportHeight: 100, itemHeight: 20, overscan: 3 })
    const range = list.getRange()
    assert.equal(range.startIndex, 0) // 未渲染出界
    assert.equal(range.endIndex, 7) // raw end 5 + 3 缓冲
    assert.equal(range.offsetY, 0)
})

test("overscan：底部夹紧，endIndex 不越过末项", () => {
    const list = createVirtualList({ itemCount: 100, viewportHeight: 100, itemHeight: 20, overscan: 3 })
    list.setScrollTop(2000) // 越界，被夹紧到 maxScroll = 1900
    const range = list.getRange()
    assert.equal(range.startIndex, 92)
    assert.equal(range.endIndex, 99)
    assert.equal(range.offsetY, 1840)
})

test("setViewportHeight 影响可视窗口大小", () => {
    const list = createVirtualList({ itemCount: 100, viewportHeight: 100, itemHeight: 20, overscan: 0 })
    assert.equal(list.getRange().endIndex, 4)
    list.setViewportHeight(200)
    assert.equal(list.getRange().endIndex, 9)
})

// ---------- 虚拟列表：边界 ----------

test("空列表：总高为 0，窗口为空且不崩溃", () => {
    const list = createVirtualList({ itemCount: 0, viewportHeight: 100, itemHeight: 20 })
    assert.equal(list.getTotalHeight(), 0)
    assert.deepEqual(list.getRange(), { startIndex: 0, endIndex: -1, offsetY: 0 })
    assert.deepEqual(list.getVisibleItems(), [])
})

test("滚动越界：负值归零", () => {
    const list = createVirtualList({ itemCount: 100, viewportHeight: 100, itemHeight: 20, overscan: 0 })
    list.setScrollTop(-500)
    assert.equal(list.getScrollTop(), 0)
    assert.equal(list.getRange().startIndex, 0)
})

test("滚动越界：超大值夹紧到末端", () => {
    const list = createVirtualList({ itemCount: 30, viewportHeight: 100, itemHeight: 25, overscan: 0 })
    list.setScrollTop(1e9)
    const range = list.getRange()
    assert.equal(range.endIndex, 29)
    assert.equal(range.offsetY, 650) // maxScroll = 750 - 100
})

test("measure 越界下标与非法高度被忽略", () => {
    const list = createVirtualList({ itemCount: 3, viewportHeight: 50, itemHeight: 10 })
    list.measure(-1, 999)
    list.measure(5, 999)
    list.measure(1, -5)
    list.measure(1, Number.NaN)
    assert.equal(list.getTotalHeight(), 30)
    assert.equal(list.getItemHeight(1), 10)
})

// ---------- 虚拟列表：变高模式 ----------

test("变高模式：measure 后前缀和偏移重算，二分定位正确", () => {
    const list = createVirtualList({ itemCount: 5, viewportHeight: 150, itemHeight: 100, overscan: 0 })
    assert.equal(list.getTotalHeight(), 500)
    assert.equal(list.getItemOffset(2), 200)

    list.measure(0, 50) // 首项比预估矮
    assert.equal(list.getItemHeight(0), 50)
    assert.equal(list.getItemOffset(1), 50) // 前缀和整体前移
    assert.equal(list.getTotalHeight(), 450)

    list.setScrollTop(60)
    const range = list.getRange()
    assert.equal(range.startIndex, 1) // 二分：offsets[1]=50<=60<offsets[2]=150
    assert.equal(range.offsetY, 50)
    assert.deepEqual(list.getVisibleItems(), [
        { index: 1, offset: 50 },
        { index: 2, offset: 150 },
    ])
})

test("变高模式：未测项用预估值，总高随实测校正", () => {
    const list = createVirtualList({ itemCount: 4, viewportHeight: 100, itemHeight: 40 })
    assert.equal(list.getItemHeight(3), 40) // 未测 → 预估
    assert.equal(list.getTotalHeight(), 160)
    list.measure(1, 100) // 比预估高
    assert.equal(list.getTotalHeight(), 220) // 40 + 100 + 40 + 40
    list.measure(3, 10) // 比预估矮
    assert.equal(list.getTotalHeight(), 190) // 40 + 100 + 40 + 10
})

test("变高模式：多次 measure 后二分定位与线性扫描一致", () => {
    const heights = [50, 20, 90, 30, 10, 60, 45, 25, 70, 35, 15, 55, 80, 40, 22, 66, 18, 44, 88, 12]
    const offsets = [0]
    for (const height of heights) offsets.push(offsets[offsets.length - 1] + height)

    const list = createVirtualList({
        itemCount: heights.length,
        viewportHeight: 80,
        itemHeight: 30, // 预估值：全部 measure 后仅作兜底
        overscan: 0,
    })
    heights.forEach((height, index) => list.measure(index, height))
    assert.equal(list.getTotalHeight(), offsets[heights.length])

    const linearStartIndex = (top: number): number => {
        let found = 0
        for (let i = 0; i <= heights.length; i++) {
            if (offsets[i] <= top) found = i
        }
        return found
    }

    for (const top of [0, 1, 49, 50, 51, 130, 250, 300, 500, 700]) {
        list.setScrollTop(top)
        assert.equal(list.getRange().startIndex, linearStartIndex(top), `top=${top}`)
    }
})

test("getVisibleItems 与 getRange 一致，位移按项高单调递增", () => {
    const list = createVirtualList({ itemCount: 50, viewportHeight: 120, itemHeight: 30, overscan: 2 })
    list.setScrollTop(300)
    const range = list.getRange()
    const items = list.getVisibleItems()
    assert.equal(items.length, range.endIndex - range.startIndex + 1)
    assert.equal(items[0].index, range.startIndex)
    assert.equal(items[0].offset, range.offsetY)
    assert.equal(items[items.length - 1].index, range.endIndex)
    for (let i = 1; i < items.length; i++) {
        assert.equal(items[i].offset - items[i - 1].offset, 30)
    }
})

// ---------- 帧调度器 ----------

function createFakeRaf(): { raf: RafFn; fire: () => number; pendingFrames: () => number } {
    const frames: Array<() => void> = []
    const raf: RafFn = (callback) => {
        frames.push(callback)
        return frames.length
    }
    return {
        raf,
        // 触发一次已注册的帧回调，模拟浏览器的一次绘制帧
        fire: () => {
            const next = frames.shift()
            if (next) next()
            return frames.length
        },
        pendingFrames: () => frames.length,
    }
}

test("帧调度：同帧内多次 schedule 合并，去重且保序", () => {
    const fake = createFakeRaf()
    const scheduler = createFrameScheduler(fake.raf)
    const calls: string[] = []
    const first = () => calls.push("first")
    const second = () => calls.push("second")
    scheduler.schedule(first)
    scheduler.schedule(second)
    scheduler.schedule(first) // 重复登记应被去重
    assert.equal(scheduler.pendingCount(), 2)
    assert.equal(fake.pendingFrames(), 1) // 同一帧只注册一次 rAF
    fake.fire()
    assert.deepEqual(calls, ["first", "second"])
    assert.equal(scheduler.pendingCount(), 0)
})

test("帧调度：不同回调按登记顺序执行", () => {
    const fake = createFakeRaf()
    const scheduler = createFrameScheduler(fake.raf)
    const order: number[] = []
    scheduler.schedule(() => order.push(1))
    scheduler.schedule(() => order.push(2))
    scheduler.schedule(() => order.push(3))
    fake.fire()
    assert.deepEqual(order, [1, 2, 3])
})

test("帧调度：flush 立即执行待办，并使已注册的旧帧失效", () => {
    const fake = createFakeRaf()
    const scheduler = createFrameScheduler(fake.raf)
    const calls: string[] = []
    scheduler.schedule(() => calls.push("x"))
    scheduler.flush()
    assert.deepEqual(calls, ["x"])
    assert.equal(scheduler.pendingCount(), 0)
    fake.fire() // 旧帧即使触发也不应重复执行
    assert.deepEqual(calls, ["x"])
})

test("帧调度：flush 后再调度不会被旧帧提前执行", () => {
    const fake = createFakeRaf()
    const scheduler = createFrameScheduler(fake.raf)
    const calls: string[] = []
    scheduler.schedule(() => calls.push("first"))
    scheduler.flush()
    scheduler.schedule(() => calls.push("second"))
    fake.fire() // 触发的是 flush 前注册的旧帧，应被作废
    assert.deepEqual(calls, ["first"])
    fake.fire() // 新注册的帧才执行 second
    assert.deepEqual(calls, ["first", "second"])
})

test("帧调度：cancel 丢弃待办且不执行", () => {
    const fake = createFakeRaf()
    const scheduler = createFrameScheduler(fake.raf)
    const calls: string[] = []
    scheduler.schedule(() => calls.push("a"))
    scheduler.cancel()
    assert.equal(scheduler.pendingCount(), 0)
    fake.fire()
    assert.deepEqual(calls, [])
})

test("帧调度：回调内再 schedule 进入下一帧执行", () => {
    const fake = createFakeRaf()
    const scheduler = createFrameScheduler(fake.raf)
    const calls: string[] = []
    scheduler.schedule(() => {
        calls.push("outer")
        scheduler.schedule(() => calls.push("inner"))
    })
    fake.fire()
    assert.deepEqual(calls, ["outer"])
    assert.equal(scheduler.pendingCount(), 1)
    fake.fire()
    assert.deepEqual(calls, ["outer", "inner"])
})
