// 文件: cases/02-type-safe-event-bus/test/event-bus.test.ts
// ============ 事件总线运行时行为回归 + 编译期类型约束 ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { createEventBus } from "../src/event-bus.js"
import type { EmitArgs, PayloadOf } from "../src/event-bus.js"

test("on 订阅后 emit 能收到 payload", () => {
    const bus = createEventBus<{ msg: string }>()
    const got: string[] = []
    bus.on("msg", (payload) => got.push(payload))
    assert.equal(bus.emit("msg", "hello"), true)
    assert.deepEqual(got, ["hello"])
})

test("多个 handler 按订阅顺序触发", () => {
    const bus = createEventBus<{ n: number }>()
    const order: string[] = []
    bus.on("n", () => order.push("a"))
    bus.on("n", () => order.push("b"))
    bus.on("n", () => order.push("c"))
    bus.emit("n", 1)
    assert.deepEqual(order, ["a", "b", "c"])
})

test("off 之后不再收到事件", () => {
    const bus = createEventBus<{ n: number }>()
    const calls: number[] = []
    const handler = (payload: number) => calls.push(payload)
    bus.on("n", handler)
    bus.emit("n", 1)
    bus.off("n", handler)
    bus.emit("n", 2)
    assert.deepEqual(calls, [1])
})

test("on 返回的取消订阅函数可用", () => {
    const bus = createEventBus<{ n: number }>()
    const calls: number[] = []
    const dispose = bus.on("n", (payload) => calls.push(payload))
    dispose()
    bus.emit("n", 1)
    assert.equal(calls.length, 0)
})

test("once 只触发一次", () => {
    const bus = createEventBus<{ n: number }>()
    let count = 0
    bus.once("n", () => {
        count += 1
    })
    bus.emit("n", 1)
    bus.emit("n", 2)
    assert.equal(count, 1)
})

test("once 的返回函数可在触发前取消", () => {
    const bus = createEventBus<{ ready: void }>()
    let called = false
    const dispose = bus.once("ready", () => {
        called = true
    })
    dispose()
    // 无参事件：emit 可省略实参
    bus.emit("ready")
    assert.equal(called, false)
})

test("emit 无监听者时安全返回 false", () => {
    const bus = createEventBus<{ n: number }>()
    assert.equal(bus.emit("n", 1), false)
})

test("emit 过程中取消订阅不影响当前遍历（快照）", () => {
    const bus = createEventBus<{ n: number }>()
    const order: string[] = []
    const second = () => order.push("b")
    bus.on("n", () => {
        order.push("a")
        bus.off("n", second)
    })
    bus.on("n", second)
    bus.emit("n", 1)
    // 快照保证第二個 handler 仍被调用一次
    assert.deepEqual(order, ["a", "b"])
})

test("同一 handler 重复订阅只保留一份（Set 去重）", () => {
    const bus = createEventBus<{ n: number }>()
    let count = 0
    const handler = () => {
        count += 1
    }
    bus.on("n", handler)
    bus.on("n", handler)
    bus.emit("n", 1)
    assert.equal(count, 1)
})

test("类型约束由 tsc 在编译期校验（见 compileTimeTypeChecks）", () => {
    assert.equal(typeof compileTimeTypeChecks, "function")
})

/**
 * 仅用于编译期类型校验：函数体不会被运行时执行。
 * tsx 只做转译不做类型检查，因此这里依赖 `tsc --noEmit` 来验证以下约束：
 * - 事件名必须是 `keyof Events`（不存在的事件名报错）；
 * - handler 的 payload 由 `Events[K]` 推导（类型不匹配报错）；
 * - 无参事件（payload 为 void）emit 可省略实参，且不允许传参。
 */
function compileTimeTypeChecks(): void {
    const bus = createEventBus<{ ready: void; tick: number; data: { id: number } }>()

    // 无参事件：emit 可省略实参
    bus.emit("ready")
    // 有参事件：必须传对应类型的 payload
    bus.emit("tick", 1)
    bus.emit("data", { id: 1 })

    // handler 参数类型由 Events[K] 自动推导
    bus.on("tick", (n) => {
        const value: number = n
        void value
    })
    bus.on("data", (d) => {
        const id: number = d.id
        void id
    })

    // @ts-expect-error 事件名不存在
    bus.emit("nope")
    // @ts-expect-error payload 类型不匹配
    bus.emit("tick", "str")
    // @ts-expect-error 无参事件不应传参
    bus.emit("ready", 1)
    // @ts-expect-error handler 参数类型错误
    bus.on("tick", (s: string) => {
        void s
    })

    // 条件类型 EmitArgs 的行为
    const noArgs: EmitArgs<void> = []
    void noArgs
    const withArg: EmitArgs<number> = [1]
    void withArg

    // infer：PayloadOf 能从 handler 反推 payload 类型
    const payload: PayloadOf<(payload: { id: number }) => void> = { id: 1 }
    void payload
}
