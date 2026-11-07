// 文件: cases/11-state-machine-lab/test/machine.test.ts
// ============ 有限状态机运行时行为回归（node:test + node:assert/strict） ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { createMachine } from "../src/machine.js"
import type { MachineOptions } from "../src/machine.js"

type LS = "idle" | "running" | "done"
type LE = "START" | "FINISH" | "ABORT" | "RESET"

interface Ctx {
    /** 计数器：START 时自增，供 ABORT 的守卫判定 */
    count: number
    /** 动作与钩子按序写入的轨迹，用于断言执行顺序 */
    trail: string[]
}

/** 构建同一台「idle → running → done」机器，便于各用例独立实例化 */
function buildMachine(options?: MachineOptions) {
    return createMachine<Ctx, LS, LE>(
        {
            states: ["idle", "running", "done"],
            initial: "idle",
            context: { count: 0, trail: [] },
            transitions: {
                idle: {
                    START: {
                        target: "running",
                        action: (ctx, payload) => {
                            ctx.count += 1
                            ctx.trail.push(`action:${String(payload)}`)
                        },
                    },
                },
                running: {
                    FINISH: {
                        target: "done",
                        action: (ctx) => {
                            ctx.trail.push("action:finish")
                        },
                    },
                    ABORT: {
                        target: "idle",
                        guard: (ctx) => ctx.count >= 2,
                        action: (ctx) => {
                            ctx.trail.push("action:abort")
                        },
                    },
                },
                done: {
                    RESET: { target: "idle" },
                },
            },
            exit: {
                idle: (ctx) => {
                    ctx.trail.push("exit:idle")
                },
                running: (ctx) => {
                    ctx.trail.push("exit:running")
                },
            },
            enter: {
                running: (ctx) => {
                    ctx.trail.push("enter:running")
                },
                done: (ctx) => {
                    ctx.trail.push("enter:done")
                },
            },
        },
        options,
    )
}

test("初始状态与 context", () => {
    const machine = buildMachine()
    assert.equal(machine.getState(), "idle")
    assert.deepEqual(machine.getContext(), { count: 0, trail: [] })
})

test("正常转移链路：idle --START--> running --FINISH--> done", () => {
    const machine = buildMachine()
    assert.equal(machine.send("START", "go"), true)
    assert.equal(machine.getState(), "running")
    assert.equal(machine.send("FINISH"), true)
    assert.equal(machine.getState(), "done")
    assert.equal(machine.getContext().count, 1)
})

test("守卫返回 false 时拦截：状态不变、send 返回 false", () => {
    const machine = buildMachine()
    machine.send("START", "go") // count 变为 1
    let notified = 0
    machine.subscribe(() => {
        notified += 1
    })
    assert.equal(machine.send("ABORT"), false) // 守卫要求 count >= 2
    assert.equal(machine.getState(), "running")
    assert.equal(notified, 0)
})

test("can 预判包含守卫判定", () => {
    const machine = buildMachine()
    machine.send("START", "go")
    assert.equal(machine.can("ABORT"), false) // count=1，守卫不通过
    machine.getContext().count = 2
    assert.equal(machine.can("ABORT"), true) // 满足守卫
    assert.equal(machine.can("FINISH"), true) // 无守卫的事件可预判
})

test("action 更新 context", () => {
    const machine = buildMachine()
    machine.send("START", "go")
    machine.send("FINISH")
    assert.equal(machine.getContext().count, 1)
    assert.deepEqual(machine.getContext().trail, ["exit:idle", "action:go", "enter:running", "exit:running", "action:finish", "enter:done"])
})

test("动作时序：exit(旧态) → action → enter(新态)", () => {
    const machine = buildMachine()
    const from = machine.getState()
    machine.send("START", "go")
    assert.equal(from, "idle")
    assert.deepEqual(machine.getContext().trail, ["exit:idle", "action:go", "enter:running"])
})

test("非法事件按 ignore 策略静默：send 返回 false", () => {
    const machine = buildMachine()
    // RESET 只在 done 状态定义，idle 下派发属于非法事件
    assert.equal(machine.send("RESET"), false)
    assert.equal(machine.getState(), "idle")
})

test("非法转移不改变状态、不通知订阅者", () => {
    const machine = buildMachine()
    machine.send("START", "go")
    let notified = 0
    machine.subscribe(() => {
        notified += 1
    })
    // 非法事件
    assert.equal(machine.send("RESET"), false)
    // 守卫拦截
    assert.equal(machine.send("ABORT"), false)
    assert.equal(machine.getState(), "running")
    assert.equal(notified, 0)
})

test("非法事件按 throw 策略抛错", () => {
    const machine = buildMachine({ onInvalid: "throw" })
    assert.throws(() => machine.send("RESET"), /非法转移/)
    assert.equal(machine.getState(), "idle")
})

test("subscribe 通知内容为 { from, to, event, payload }", () => {
    const machine = buildMachine()
    const seen: Array<{ from: LS; to: LS; event: LE; payload: unknown }> = []
    machine.subscribe((info) => seen.push(info))
    machine.send("START", "go")
    assert.deepEqual(seen, [{ from: "idle", to: "running", event: "START", payload: "go" }])
})

test("subscribe 返回的取消订阅函数生效", () => {
    const machine = buildMachine()
    let calls = 0
    const unsubscribe = machine.subscribe(() => {
        calls += 1
    })
    machine.send("START", "go")
    unsubscribe()
    machine.send("FINISH")
    assert.equal(calls, 1)
})

test("matches 便捷查询", () => {
    const machine = buildMachine()
    assert.equal(machine.matches("idle"), true)
    assert.equal(machine.matches("running"), false)
    machine.send("START", "go")
    assert.equal(machine.matches("running"), true)
})

test("配置校验：initial 或 target 不在 states 时抛错", () => {
    assert.throws(
        () =>
            createMachine<Ctx, LS, LE>({
                states: ["idle", "running", "done"],
                // @ts-expect-error 初始状态 "ghost" 不在 states 中
                initial: "ghost",
                transitions: {},
            }),
        /非法配置/,
    )
    assert.throws(
        () =>
            createMachine<Ctx, LS, LE>({
                states: ["idle", "running", "done"],
                initial: "idle",
                transitions: {
                    // @ts-expect-error 目标状态 "ghost" 不在 states 中
                    idle: { START: { target: "ghost" } },
                },
            }),
        /非法配置/,
    )
})

test("编译期约束：非法事件名无法通过类型检查", () => {
    const machine = buildMachine()
    // @ts-expect-error "JUMP" 不属于事件联合类型 LE，编译期即报错
    const ok = machine.send("JUMP")
    assert.equal(ok, false) // 运行时按 ignore 兜底
})
