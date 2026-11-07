// 文件: cases/05-state-store-lab/src/store.ts
// ============ 手写极简响应式状态容器：不可变更新 + 订阅 + 记忆化选择器 + 中间件 ============

/** 浅比较：逐键比较两个对象的自有可枚举属性（基于 Object.is，避免 NaN 误判） */
export function shallowEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true
    if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
        return false
    }
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    const ra = a as Record<string, unknown>
    const rb = b as Record<string, unknown>
    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(rb, key)) return false
        if (!Object.is(ra[key], rb[key])) return false
    }
    return true
}

/** 函数式更新：由旧状态推导出一份补丁 */
export type StateUpdater<S extends object> = (state: S) => Partial<S>

/** 一次 setState 的入参：对象补丁（浅合并）或函数式 updater */
export type StatePatch<S extends object> = Partial<S> | StateUpdater<S>

/** 完成一次 setState 的函数签名，中间件链的末端最终执行它 */
export type SetState<S extends object> = (patch: StatePatch<S>) => void

/** 订阅回调：拿到新状态与上一次状态 */
export type Listener<S extends object> = (state: S, prev: S) => void

/** 选择器相等判定，默认 Object.is */
export type EqualityFn<T> = (a: T, b: T) => boolean

/** 中间件可使用的最小 API */
export interface MiddlewareApi<S extends object> {
    getState(): S
}

/** 中间件：拿到 api 后返回 (next) => setState，包裹并增强 setState */
export type Middleware<S extends object> = (
    api: MiddlewareApi<S>,
) => (next: SetState<S>) => SetState<S>

/** 状态容器对外接口 */
export interface StoreApi<S extends object> {
    /** 读取当前状态 */
    getState(): S
    /** 更新状态：对象浅合并 / 函数式 updater，不可变更新 */
    setState: SetState<S>
    /** 订阅状态变化，返回取消订阅函数 */
    subscribe(listener: Listener<S>): () => void
    /** 记忆化选择器：同一状态快照重复调用不重算，派生值等价时沿用上次引用 */
    select<T>(selector: (state: S) => T, equalityFn?: EqualityFn<T>): () => T
    /** 批处理：把区间内的多次 setState 合并为一次通知 */
    batch(fn: () => void): void
}

export interface CreateStoreOptions<S extends object> {
    /** 中间件数组：数组顺序即「外层 → 内层」的包裹顺序 */
    middleware?: Middleware<S>[]
}

/**
 * logger 中间件：在 setState 前后各取一次状态，交给注入的 log 回调。
 * 默认写到 console；测试注入替身即可保证输出可控、断言确定。
 */
export function logger<S extends object>(
    options: { name?: string; log?: (event: { name: string; prev: S; next: S }) => void } = {},
): Middleware<S> {
    const name = options.name ?? "store"
    const log =
        options.log ??
        ((event) => {
            console.log(`[${event.name}]`, event.prev, "->", event.next)
        })
    return (api) => (next) => (patch) => {
        const prev = api.getState()
        next(patch)
        log({ name, prev, next: api.getState() })
    }
}

/**
 * 创建一个极简状态容器。
 * 核心只有四件事：不可变更新的 state、保序的订阅集合、按快照缓存的 select、包裹 setState 的中间件链。
 */
export function createStore<S extends object>(
    initialState: S,
    options: CreateStoreOptions<S> = {},
): StoreApi<S> {
    let state: S = initialState
    const listeners = new Set<Listener<S>>()

    // 批处理深度：> 0 时只做脏标记，等最外层 batch 结束再统一通知
    let batchDepth = 0
    // 首个变更前的状态快照；非 null 表示有「待通知」的变更
    let prevBeforeFlush: S | null = null

    function flush(): void {
        if (batchDepth > 0) return
        if (prevBeforeFlush === null) return
        const prev = prevBeforeFlush
        prevBeforeFlush = null
        const current = state
        // 快照后再遍历：允许回调内部增删订阅而不影响本次派发
        for (const listener of [...listeners]) listener(current, prev)
    }

    const baseSetState: SetState<S> = (patch) => {
        const resolved: Partial<S> =
            typeof patch === "function" ? (patch as StateUpdater<S>)(state) : patch
        if (resolved === null || typeof resolved !== "object") {
            throw new TypeError("setState 只接受对象补丁，或返回对象补丁的 updater")
        }
        const nextState = { ...state, ...resolved } as S
        // 浅比较：值未变则不换引用、不通知订阅者
        if (shallowEqual(state, nextState)) return
        if (prevBeforeFlush === null) prevBeforeFlush = state
        state = nextState
        flush()
    }

    const api: MiddlewareApi<S> = { getState: () => state }

    // reverse 后 reduce：使数组第一个中间件成为最外层，最先执行
    const middlewares = options.middleware ?? []
    const setState = middlewares
        .slice()
        .reverse()
        .reduce<SetState<S>>((next, middleware) => middleware(api)(next), baseSetState)

    const getState = (): S => state

    const subscribe = (listener: Listener<S>): (() => void) => {
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    }

    const select = <T>(
        selector: (state: S) => T,
        equalityFn: EqualityFn<T> = Object.is,
    ): (() => T) => {
        let hasCache = false
        let cachedState: S | undefined
        let cachedResult!: T
        return () => {
            const current = state
            // 依赖（状态快照）未变：直接复用上次计算结果，不重复调用 selector
            if (hasCache && current === cachedState) return cachedResult
            const result = selector(current)
            // 派生值经 equalityFn 判定与原值等价时沿用旧引用，保证下游引用稳定
            if (hasCache && equalityFn(cachedResult, result)) {
                cachedState = current
                return cachedResult
            }
            cachedState = current
            cachedResult = result
            hasCache = true
            return result
        }
    }

    const batch = (fn: () => void): void => {
        batchDepth += 1
        try {
            fn()
        } finally {
            batchDepth -= 1
            if (batchDepth === 0) flush()
        }
    }

    return { getState, setState, subscribe, select, batch }
}
