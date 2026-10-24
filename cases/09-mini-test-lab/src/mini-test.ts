// 文件: cases/09-mini-test-lab/src/mini-test.ts
// ============ 手写迷你测试框架：断言库 + 运行器 + mock ============

// ---------------- 深比较 ----------------

/** 普通对象：原型为 Object.prototype 或 null 的对象字面量 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) return false
    const proto = Object.getPrototypeOf(value) as unknown
    return proto === Object.prototype || proto === null
}

/** 深比较：primitive 交给 Object.is，数组按元素、普通对象按键递归比较 */
export function deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
        return a.every((item, index) => deepEqual(item, b[index]))
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const keysA = Object.keys(a)
        const keysB = Object.keys(b)
        if (keysA.length !== keysB.length) return false
        return keysA.every(
            (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
        )
    }
    return false
}

// ---------------- 断言库 ----------------

/** 断言失败时抛出的错误类型，便于宿主的测试区分「断言失败」与「用例自身抛错」 */
export class AssertionError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "AssertionError"
    }
}

/** toThrow 可以接受的期望值：字符串匹配 message、正则测试 message、构造器断言实例 */
export type ExpectedThrow = string | RegExp | ErrorConstructor

/** 把任意值渲染成简短、稳定的可读文本，用于断言失败信息 */
function fmt(value: unknown): string {
    if (typeof value === "string") return JSON.stringify(value)
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`
    if (typeof value === "object" && value !== null) {
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }
    return String(value)
}

function describeExpected(expected: ExpectedThrow | undefined): string {
    if (expected === undefined) return ""
    if (typeof expected === "string") return `（message 包含 ${JSON.stringify(expected)}）`
    if (expected instanceof RegExp) return `（message 匹配 ${expected}）`
    return `（${expected.name} 实例）`
}

function matchesThrown(thrown: unknown, expected: ExpectedThrow | undefined): boolean {
    if (expected === undefined) return true
    if (typeof expected === "string") {
        return thrown instanceof Error && thrown.message.includes(expected)
    }
    if (expected instanceof RegExp) {
        return thrown instanceof Error && expected.test(thrown.message)
    }
    if (typeof expected === "function") {
        return thrown instanceof (expected as Function)
    }
    throw new TypeError("toThrow 的期望值只支持 undefined / string / RegExp / Error 构造器")
}

export interface Matchers {
    /** Object.is 严格相等（NaN 视为相等，+0 / -0 视为不等） */
    toBe(expected: unknown): void
    /** 深度相等（数组与普通对象递归比较） */
    toEqual(expected: unknown): void
    toBeTruthy(): void
    toBeFalsy(): void
    /** 断言函数抛出错误：省略则只要求抛出，string 匹配 message，RegExp 测试 message，构造器断言实例 */
    toThrow(expected?: ExpectedThrow): void
}

export interface Expectation extends Matchers {
    /** 取反版 matcher 集合：断言逻辑只写一份，通过 getter 暴露 */
    readonly not: Matchers
}

function createMatchers(actual: unknown, negated: boolean): Matchers {
    const check = (pass: boolean, positive: string, negative: string): void => {
        if (negated ? pass : !pass) {
            throw new AssertionError(negated ? negative : positive)
        }
    }
    return {
        toBe(expected: unknown): void {
            check(
                Object.is(actual, expected),
                `期望 ${fmt(actual)} 与 ${fmt(expected)} 严格相等`,
                `期望 ${fmt(actual)} 与 ${fmt(expected)} 不严格相等`,
            )
        },
        toEqual(expected: unknown): void {
            check(
                deepEqual(actual, expected),
                `期望 ${fmt(actual)} 深度等于 ${fmt(expected)}`,
                `期望 ${fmt(actual)} 不深度等于 ${fmt(expected)}`,
            )
        },
        toBeTruthy(): void {
            check(Boolean(actual), `期望 ${fmt(actual)} 为真值`, `期望 ${fmt(actual)} 不为真值`)
        },
        toBeFalsy(): void {
            check(!actual, `期望 ${fmt(actual)} 为假值`, `期望 ${fmt(actual)} 不为假值`)
        },
        toThrow(expected?: ExpectedThrow): void {
            if (typeof actual !== "function") {
                throw new TypeError("toThrow 只能用于函数")
            }
            let thrown: unknown
            let didThrow = false
            try {
                ;(actual as () => unknown)()
            } catch (error) {
                didThrow = true
                thrown = error
            }
            check(
                didThrow && matchesThrown(thrown, expected),
                `期望函数抛出错误${describeExpected(expected)}`,
                `期望函数不抛出错误${describeExpected(expected)}`,
            )
        },
    }
}

/** 生成一组断言，`.not` 为取反版本 */
export function expect(actual: unknown): Expectation {
    return { ...createMatchers(actual, false), not: createMatchers(actual, true) }
}

// ---------------- mock ----------------

export interface MockFn<TArgs extends unknown[] = unknown[], TReturn = unknown> {
    (...args: TArgs): TReturn
    /** 每次调用的实参列表，按调用顺序排列 */
    readonly calls: TArgs[]
    /** 调用次数，由 calls.length 派生 */
    readonly callCount: number
    /** 设定固定返回值（覆盖当前实现） */
    mockReturnValue(value: TReturn): MockFn<TArgs, TReturn>
    /** 替换实现（覆盖当前实现） */
    mockImplementation(fn: (...args: TArgs) => TReturn): MockFn<TArgs, TReturn>
    /** 只清空调用记录，不影响当前实现 */
    mockClear(): MockFn<TArgs, TReturn>
}

/** 创建一个可记录调用的 mock 函数 */
export function mockFn<TReturn = unknown, TArgs extends unknown[] = unknown[]>(
    impl?: (...args: TArgs) => TReturn,
): MockFn<TArgs, TReturn> {
    const calls: TArgs[] = []
    let current: (...args: TArgs) => TReturn = impl ?? ((() => undefined) as () => TReturn)

    const fn = ((...args: TArgs): TReturn => {
        calls.push(args)
        return current(...args)
    }) as unknown as MockFn<TArgs, TReturn>

    Object.defineProperties(fn, {
        calls: { get: () => calls },
        callCount: { get: () => calls.length },
    })
    fn.mockReturnValue = (value: TReturn): MockFn<TArgs, TReturn> => {
        current = () => value
        return fn
    }
    fn.mockImplementation = (next: (...args: TArgs) => TReturn): MockFn<TArgs, TReturn> => {
        current = next
        return fn
    }
    fn.mockClear = (): MockFn<TArgs, TReturn> => {
        calls.length = 0
        return fn
    }
    return fn
}

// ---------------- 运行器 ----------------

export type TestStatus = "passed" | "failed" | "skipped"

export interface TestResult {
    /** 用例名（不含套件前缀） */
    name: string
    /** 套件链 + 用例名，如 "outer > inner > case" */
    fullName: string
    status: TestStatus
    /** 仅失败时存在：被捕获的错误 */
    error?: unknown
}

export interface RunSummary {
    passed: number
    failed: number
    skipped: number
    results: TestResult[]
}

export type TestFn = () => void | Promise<void>

export interface TestFunction {
    (name: string, fn: TestFn): Promise<TestResult>
    /** 跳过该用例 */
    skip(name: string, fn: TestFn): Promise<TestResult>
    /** 独占运行：只要存在 only，非 only 用例一律跳过 */
    only(name: string, fn: TestFn): Promise<TestResult>
}

export interface Runner {
    /** 定义一个套件，可嵌套；套件是钩子继承的边界 */
    describe(name: string, fn: () => void): void
    it: TestFunction
    test: TestFunction
    beforeEach(fn: TestFn): void
    afterEach(fn: TestFn): void
    beforeAll(fn: TestFn): void
    afterAll(fn: TestFn): void
    /** 执行全部已注册用例，失败时捕获错误而不抛出进程 */
    run(): Promise<RunSummary>
    /** 清空所有用例与钩子，便于隔离多次运行 */
    reset(): void
}

interface SuiteNode {
    name: string
    beforeAll: TestFn[]
    afterAll: TestFn[]
    beforeEach: TestFn[]
    afterEach: TestFn[]
}

type TestMode = "normal" | "skip" | "only"

interface TestCase {
    name: string
    fn: TestFn
    mode: TestMode
    /** 注册时从根到叶的套件链，钩子即沿此链继承 */
    suites: SuiteNode[]
    resolve(result: TestResult): void
}

/**
 * 创建一个独立的运行器。框架状态全部封在闭包里：
 * 用例注册于 describe/it，钩子挂在套件节点上，run() 时才统一执行。
 */
export function createRunner(): Runner {
    const root: SuiteNode = { name: "", beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] }
    const stack: SuiteNode[] = [root]
    const cases: TestCase[] = []

    const current = (): SuiteNode => stack[stack.length - 1]

    const fullNameOf = (testCase: TestCase): string =>
        [...testCase.suites.filter((suite) => suite.name !== "").map((suite) => suite.name), testCase.name].join(
            " > ",
        )

    const register = (name: string, fn: TestFn, mode: TestMode): Promise<TestResult> => {
        let resolveFn!: (result: TestResult) => void
        const promise = new Promise<TestResult>((resolve) => {
            resolveFn = resolve
        })
        cases.push({ name, fn, mode, suites: [...stack], resolve: resolveFn })
        return promise
    }

    const describe = (name: string, fn: () => void): void => {
        const node: SuiteNode = { name, beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] }
        stack.push(node)
        try {
            fn()
        } finally {
            stack.pop()
        }
    }

    const it: TestFunction = Object.assign(
        (name: string, fn: TestFn): Promise<TestResult> => register(name, fn, "normal"),
        {
            skip: (name: string, fn: TestFn): Promise<TestResult> => register(name, fn, "skip"),
            only: (name: string, fn: TestFn): Promise<TestResult> => register(name, fn, "only"),
        },
    )

    const beforeEach = (fn: TestFn): void => {
        current().beforeEach.push(fn)
    }
    const afterEach = (fn: TestFn): void => {
        current().afterEach.push(fn)
    }
    const beforeAll = (fn: TestFn): void => {
        current().beforeAll.push(fn)
    }
    const afterAll = (fn: TestFn): void => {
        current().afterAll.push(fn)
    }

    const run = async (): Promise<RunSummary> => {
        const hasOnly = cases.some((item) => item.mode === "only")
        const results: TestResult[] = []
        const beforeAllDone = new Set<SuiteNode>()
        const suiteErrors = new Map<SuiteNode, unknown>()
        const suiteOrder: SuiteNode[] = []

        for (const testCase of cases) {
            const runnable = testCase.mode === "only" || (testCase.mode !== "skip" && !hasOnly)
            if (!runnable) {
                const skipped: TestResult = {
                    name: testCase.name,
                    fullName: fullNameOf(testCase),
                    status: "skipped",
                }
                results.push(skipped)
                testCase.resolve(skipped)
                continue
            }

            // beforeAll：每个套件只跑一次（根 → 叶）
            for (const suite of testCase.suites) {
                if (beforeAllDone.has(suite)) continue
                beforeAllDone.add(suite)
                suiteOrder.push(suite)
                try {
                    for (const hook of suite.beforeAll) await hook()
                } catch (error) {
                    suiteErrors.set(suite, error)
                }
            }

            // 祖先套件的 beforeAll 失败：本用例直接判失败，不执行钩子与用例体
            const inherited = testCase.suites.find((suite) => suiteErrors.has(suite))
            if (inherited !== undefined) {
                const failed: TestResult = {
                    name: testCase.name,
                    fullName: fullNameOf(testCase),
                    status: "failed",
                    error: suiteErrors.get(inherited),
                }
                results.push(failed)
                testCase.resolve(failed)
                continue
            }

            let error: unknown
            let failed = false
            try {
                for (const suite of testCase.suites) {
                    for (const hook of suite.beforeEach) await hook()
                }
                await testCase.fn()
            } catch (caught) {
                failed = true
                error = caught
            }
            // afterEach：内 → 外，无论用例是否抛错都执行
            for (const suite of [...testCase.suites].reverse()) {
                for (const hook of [...suite.afterEach].reverse()) {
                    try {
                        await hook()
                    } catch (caught) {
                        if (!failed) {
                            failed = true
                            error = caught
                        }
                    }
                }
            }

            const result: TestResult = failed
                ? { name: testCase.name, fullName: fullNameOf(testCase), status: "failed", error }
                : { name: testCase.name, fullName: fullNameOf(testCase), status: "passed" }
            results.push(result)
            testCase.resolve(result)
        }

        // afterAll：叶 → 根，每套件一次；此阶段错误不改变用例计数
        for (const suite of [...suiteOrder].reverse()) {
            for (const hook of [...suite.afterAll].reverse()) {
                try {
                    await hook()
                } catch {
                    // 忽略：afterAll 错误不冒泡出 run()
                }
            }
        }

        return {
            passed: results.filter((item) => item.status === "passed").length,
            failed: results.filter((item) => item.status === "failed").length,
            skipped: results.filter((item) => item.status === "skipped").length,
            results,
        }
    }

    const reset = (): void => {
        cases.length = 0
        stack.length = 0
        stack.push(root)
        root.beforeAll.length = 0
        root.afterAll.length = 0
        root.beforeEach.length = 0
        root.afterEach.length = 0
    }

    return { describe, it, test: it, beforeEach, afterEach, beforeAll, afterAll, run, reset }
}

// ---------------- 默认运行器（模块级 API） ----------------

const defaultRunner = createRunner()

export const describe = defaultRunner.describe
export const it = defaultRunner.it
export const test = defaultRunner.test
export const beforeEach = defaultRunner.beforeEach
export const afterEach = defaultRunner.afterEach
export const beforeAll = defaultRunner.beforeAll
export const afterAll = defaultRunner.afterAll
export const run = defaultRunner.run
export const reset = defaultRunner.reset
