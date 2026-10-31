// 文件: cases/09-mini-test-lab/test/mini-test.test.ts
// ============ 用 node:test 元测试「迷你测试框架」自身的行为 ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { AssertionError, createRunner, deepEqual, expect, mockFn } from "../src/mini-test.js"

test("describe 收集用例：数量与 fullName 顺序正确", async () => {
    const runner = createRunner()
    runner.describe("outer", () => {
        runner.it("a", () => {})
        runner.describe("inner", () => {
            runner.it("b", () => {})
        })
        runner.it("c", () => {})
    })
    const summary = await runner.run()
    assert.equal(summary.results.length, 3)
    assert.deepEqual(
        summary.results.map((item) => item.fullName),
        ["outer > a", "outer > inner > b", "outer > c"],
    )
    assert.equal(summary.passed, 3)
})

test("it 返回的 Promise 在 run 后解析为对应用例结果", async () => {
    const runner = createRunner()
    const pending = runner.it("later", () => {})
    const summary = await runner.run()
    const result = await pending
    assert.equal(result.status, "passed")
    assert.equal(result.name, "later")
    assert.equal(result.fullName, "later")
    assert.equal(summary.results[0], result)
    assert.equal(summary.results[0].status, "passed")
})

test("全部通过时汇总计数正确", async () => {
    const runner = createRunner()
    runner.it("a", () => {})
    runner.it("b", () => {
        expect(2).toBe(2)
    })
    const summary = await runner.run()
    assert.equal(summary.passed, 2)
    assert.equal(summary.failed, 0)
    assert.equal(summary.skipped, 0)
    assert.equal(summary.results.length, 2)
})

test("断言失败被捕获为 failed，且 run 不抛异常", async () => {
    const runner = createRunner()
    runner.it("assert fails", () => {
        expect(1).toBe(2)
    })
    const summary = await runner.run()
    assert.equal(summary.failed, 1)
    assert.equal(summary.passed, 0)
    assert.equal(summary.results[0].status, "failed")
    const error = summary.results[0].error
    assert.ok(error instanceof AssertionError)
    assert.match((error as AssertionError).message, /严格相等/)
})

test("toBe 遵循 Object.is：NaN 相等、+0 与 -0 不等", async () => {
    const runner = createRunner()
    runner.it("NaN equals NaN", () => {
        expect(Number.NaN).toBe(Number.NaN)
    })
    runner.it("plus zero is not minus zero", () => {
        expect(0).toBe(-0)
    })
    const summary = await runner.run()
    assert.equal(summary.passed, 1)
    assert.equal(summary.failed, 1)
})

test("toEqual 深比较数组与普通对象", async () => {
    const runner = createRunner()
    runner.it("deep arrays", () => {
        expect([1, [2, 3]]).toEqual([1, [2, 3]])
    })
    runner.it("deep objects", () => {
        expect({ a: 1, b: { c: 2 } }).toEqual({ a: 1, b: { c: 2 } })
    })
    runner.it("different keys fail", () => {
        expect({ a: 1 }).toEqual({ a: 1, b: 2 })
    })
    const summary = await runner.run()
    assert.equal(summary.passed, 2)
    assert.equal(summary.failed, 1)
    assert.equal(deepEqual({ x: [1, 2] }, { x: [1, 2] }), true)
    assert.equal(deepEqual([1, 2], [1, 2, 3]), false)
})

test("toBeTruthy / toBeFalsy 判定", async () => {
    const runner = createRunner()
    runner.it("truthy", () => {
        expect("x").toBeTruthy()
    })
    runner.it("falsy", () => {
        expect("").toBeFalsy()
    })
    runner.it("zero is falsy, truthy 断言应失败", () => {
        expect(0).toBeTruthy()
    })
    const summary = await runner.run()
    assert.equal(summary.passed, 2)
    assert.equal(summary.failed, 1)
})

test("toThrow 匹配 message、Error 类型，不抛出即失败", async () => {
    const runner = createRunner()
    runner.it("message contains", () => {
        expect(() => {
            throw new Error("boom happened")
        }).toThrow("boom")
    })
    runner.it("error class", () => {
        expect(() => {
            throw new TypeError("bad type")
        }).toThrow(TypeError)
    })
    runner.it("no throw fails", () => {
        expect(() => 42).toThrow()
    })
    const summary = await runner.run()
    assert.equal(summary.passed, 2)
    assert.equal(summary.failed, 1)
})

test("not 取反", async () => {
    const runner = createRunner()
    runner.it("not equals", () => {
        expect(1).not.toBe(2)
    })
    runner.it("not truthy", () => {
        expect(0).not.toBeTruthy()
    })
    runner.it("not fails when equal", () => {
        expect(1).not.toBe(1)
    })
    const summary = await runner.run()
    assert.equal(summary.passed, 2)
    assert.equal(summary.failed, 1)
})

test("beforeEach/afterEach 包裹每个用例，beforeAll/afterAll 各执行一次", async () => {
    const runner = createRunner()
    const order: string[] = []
    let beforeAllCount = 0
    let afterAllCount = 0
    runner.describe("suite", () => {
        runner.beforeAll(() => {
            beforeAllCount += 1
            order.push("beforeAll")
        })
        runner.afterAll(() => {
            afterAllCount += 1
            order.push("afterAll")
        })
        runner.beforeEach(() => {
            order.push("beforeEach")
        })
        runner.afterEach(() => {
            order.push("afterEach")
        })
        runner.it("one", () => {
            order.push("test:one")
        })
        runner.it("two", () => {
            order.push("test:two")
        })
    })
    await runner.run()
    assert.equal(beforeAllCount, 1)
    assert.equal(afterAllCount, 1)
    assert.deepEqual(order, [
        "beforeAll",
        "beforeEach",
        "test:one",
        "afterEach",
        "beforeEach",
        "test:two",
        "afterEach",
        "afterAll",
    ])
})

test("嵌套套件的钩子由外向内继承", async () => {
    const runner = createRunner()
    const order: string[] = []
    runner.describe("outer", () => {
        runner.beforeEach(() => {
            order.push("outer:beforeEach")
        })
        runner.afterEach(() => {
            order.push("outer:afterEach")
        })
        runner.it("outer-case", () => {
            order.push("outer:case")
        })
        runner.describe("inner", () => {
            runner.beforeEach(() => {
                order.push("inner:beforeEach")
            })
            runner.afterEach(() => {
                order.push("inner:afterEach")
            })
            runner.it("inner-case", () => {
                order.push("inner:case")
            })
        })
    })
    await runner.run()
    assert.deepEqual(order, [
        "outer:beforeEach",
        "outer:case",
        "outer:afterEach",
        "outer:beforeEach",
        "inner:beforeEach",
        "inner:case",
        "inner:afterEach",
        "outer:afterEach",
    ])
})

test("test.skip 语义：不计入通过且不执行用例体", async () => {
    const runner = createRunner()
    let skippedRan = false
    runner.it.skip("skipped", () => {
        skippedRan = true
    })
    runner.it("kept", () => {})
    const summary = await runner.run()
    assert.equal(skippedRan, false)
    assert.equal(summary.passed, 1)
    assert.equal(summary.skipped, 1)
    assert.equal(summary.results[0].status, "skipped")
})

test("test.only 语义：存在 only 时只跑 only", async () => {
    const runner = createRunner()
    const seen: string[] = []
    runner.it("a", () => {
        seen.push("a")
    })
    runner.it.only("b", () => {
        seen.push("b")
    })
    runner.it("c", () => {
        seen.push("c")
    })
    const summary = await runner.run()
    assert.deepEqual(seen, ["b"])
    assert.equal(summary.passed, 1)
    assert.equal(summary.skipped, 2)
})

test("mockFn 记录 calls 与 callCount", () => {
    const add = mockFn((a: number, b: number) => a + b)
    assert.equal(add(1, 2), 3)
    assert.equal(add(2, 3), 5)
    assert.equal(add.callCount, 2)
    assert.deepEqual(add.calls, [
        [1, 2],
        [2, 3],
    ])
})

test("mockFn 的 mockReturnValue / mockImplementation / mockClear", () => {
    const fn = mockFn((value: number) => value * 2)
    fn.mockReturnValue(7)
    assert.equal(fn(1), 7)
    fn.mockImplementation((value: number) => value + 100)
    assert.equal(fn(1), 101)
    assert.equal(fn.callCount, 2)
    fn.mockClear()
    assert.equal(fn.callCount, 0)
    assert.deepEqual(fn.calls, [])
    assert.equal(fn(2), 102) // mockClear 不影响当前实现
})

test("异步用例被 await：成功与失败都能判定", async () => {
    const runner = createRunner()
    let done = false
    runner.it("async ok", async () => {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 5)
        })
        done = true
    })
    runner.it("async fail", async () => {
        await Promise.resolve()
        throw new Error("async boom")
    })
    const summary = await runner.run()
    assert.equal(done, true)
    assert.equal(summary.passed, 1)
    assert.equal(summary.failed, 1)
    assert.equal((summary.results[1].error as Error).message, "async boom")
})

test("失败用例不中断其它用例", async () => {
    const runner = createRunner()
    const ran: string[] = []
    runner.it("first", () => {
        ran.push("first")
    })
    runner.it("boom", () => {
        throw new Error("boom")
    })
    runner.it("third", () => {
        ran.push("third")
    })
    const summary = await runner.run()
    assert.deepEqual(ran, ["first", "third"])
    assert.equal(summary.passed, 2)
    assert.equal(summary.failed, 1)
    assert.equal((summary.results[1].error as Error).message, "boom")
})
