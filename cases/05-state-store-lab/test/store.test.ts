// 文件: cases/05-state-store-lab/test/store.test.ts
// ============ 状态容器运行时行为回归（node:test + node:assert/strict） ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { createStore, logger, shallowEqual } from "../src/store.js"
import type { Middleware } from "../src/store.js"

interface Counter {
    count: number
    label: string
}

test("getState 返回初始状态", () => {
    const store = createStore<Counter>({ count: 0, label: "a" })
    assert.deepEqual(store.getState(), { count: 0, label: "a" })
})

test("setState 对象补丁浅合并，且不修改原状态", () => {
    const initial: Counter = { count: 0, label: "a" }
    const store = createStore<Counter>(initial)
    const before = store.getState()
    store.setState({ count: 1 })
    assert.deepEqual(store.getState(), { count: 1, label: "a" })
    assert.notEqual(store.getState(), before) // 换取新引用（不可变更新）
    assert.deepEqual(initial, { count: 0, label: "a" }) // 原对象未被改写
})

test("setState 支持函数式 updater", () => {
    const store = createStore<Counter>({ count: 0, label: "a" })
    store.setState((s) => ({ count: s.count + 1 }))
    store.setState((s) => ({ count: s.count + 1 }))
    assert.equal(store.getState().count, 2)
})

test("setState 后按订阅顺序通知，并能拿到 new / prev", () => {
    const store = createStore<Counter>({ count: 0, label: "a" })
    const order: string[] = []
    let seen: { now: number; prevCount: number } | undefined
    store.subscribe((state, prev) => {
        order.push("first")
        seen = { now: state.count, prevCount: prev.count }
    })
    store.subscribe(() => order.push("second"))
    store.setState({ count: 5 })
    assert.deepEqual(order, ["first", "second"])
    assert.deepEqual(seen, { now: 5, prevCount: 0 })
})

test("subscribe 返回的取消订阅函数生效", () => {
    const store = createStore<Counter>({ count: 0, label: "a" })
    let calls = 0
    const unsubscribe = store.subscribe(() => {
        calls += 1
    })
    store.setState({ count: 1 })
    unsubscribe()
    store.setState({ count: 2 })
    assert.equal(calls, 1)
})

test("浅比较后值未变则不通知", () => {
    const store = createStore<Counter>({ count: 0, label: "a" })
    let calls = 0
    store.subscribe(() => {
        calls += 1
    })
    store.setState({ count: 0 }) // 与现值相同
    store.setState((s) => ({ count: s.count }))
    assert.equal(calls, 0)
    store.setState({ count: 1 }) // 真的变了
    assert.equal(calls, 1)
})

test("setState 传入非法补丁时抛错", () => {
    const store = createStore<Counter>({ count: 0, label: "a" })
    // @ts-expect-error 故意传入 null 以校验运行时兜底
    assert.throws(() => store.setState(null), TypeError)
    // @ts-expect-error updater 必须返回对象，返回数字属非法
    assert.throws(() => store.setState((s) => s.count), TypeError)
})

test("select 记忆化：同一状态快照下不重复计算", () => {
    const store = createStore<Counter>({ count: 1, label: "a" })
    let computed = 0
    const getDouble = store.select((s) => {
        computed += 1
        return s.count * 2
    })
    assert.equal(getDouble(), 2)
    assert.equal(getDouble(), 2)
    assert.equal(computed, 1) // 第二次命中缓存
    store.setState({ count: 1 }) // 浅比较无变化：快照不变
    assert.equal(getDouble(), 2)
    assert.equal(computed, 1) // 依旧不重算
    store.setState({ count: 3 })
    assert.equal(getDouble(), 6)
    assert.equal(computed, 2) // 快照变化才重算
})

test("select 的 equalityFn：派生值等价时沿用上次引用", () => {
    const store = createStore<{ a: number; b: number }>({ a: 1, b: 10 })
    const getA = store.select((s) => ({ a: s.a }), shallowEqual)
    const first = getA()
    store.setState({ b: 5 }) // a 不变：派生对象浅相等
    assert.equal(getA(), first) // 引用稳定
    store.setState({ a: 2 }) // a 改变：返回新对象
    assert.deepEqual(getA(), { a: 2 })
    assert.notEqual(getA(), first)
})

test("logger 中间件包裹 setState", () => {
    const events: Array<{ name: string; prev: Counter; next: Counter }> = []
    const spy: Middleware<Counter> = logger<Counter>({
        name: "counter",
        log: (event) => events.push(event),
    })
    const store = createStore<Counter>({ count: 0, label: "a" }, { middleware: [spy] })
    store.setState({ count: 1 })
    assert.equal(events.length, 1)
    assert.equal(events[0].name, "counter")
    assert.equal(events[0].prev.count, 0)
    assert.equal(events[0].next.count, 1)
    assert.equal(store.getState().count, 1) // 中间件未阻断原本的 setState
})

test("多个中间件按数组顺序由外向内包裹", () => {
    const order: string[] = []
    const wrap =
        (tag: string): Middleware<Counter> =>
        () =>
        (next) =>
        (patch) => {
            order.push(`${tag}:before`)
            next(patch)
            order.push(`${tag}:after`)
        }
    const store = createStore<Counter>(
        { count: 0, label: "a" },
        { middleware: [wrap("outer"), wrap("inner")] },
    )
    store.setState({ count: 1 })
    assert.deepEqual(order, ["outer:before", "inner:before", "inner:after", "outer:after"])
    assert.equal(store.getState().count, 1)
})

test("batch 把多次 setState 合并为一次通知", () => {
    const store = createStore<Counter>({ count: 0, label: "a" })
    let calls = 0
    let last: Counter | undefined
    store.subscribe((state) => {
        calls += 1
        last = state
    })
    store.batch(() => {
        store.setState({ count: 1 })
        store.setState({ count: 2 })
        store.setState({ label: "b" })
    })
    assert.equal(calls, 1)
    assert.deepEqual(last, { count: 2, label: "b" })
})

test("batch 期间 getState 立即可见最新值", () => {
    const store = createStore<Counter>({ count: 0, label: "a" })
    let during: Counter | undefined
    store.batch(() => {
        store.setState({ count: 1 })
        during = store.getState()
        store.setState({ count: 2 })
    })
    assert.equal(during?.count, 1)
    assert.equal(store.getState().count, 2)
})
