// 文件: cases/11-state-machine-lab/src/machine.ts
// ============ 手写类型安全的有限状态机：转移表 + 守卫 + 动作/钩子 + 可订阅 ============

/** 单个转移的定义：目标状态、可选守卫、可选动作 */
export interface TransitionSpec<Ctx, S extends string> {
    /** 转移成功后的目标状态 */
    target: S
    /** 守卫：返回 false 则本次转移被拦截（应为纯函数，勿产生副作用） */
    guard?: (ctx: Ctx, payload: unknown) => boolean
    /** 动作：转移成功时执行，可读取并更新 context，同时拿到 payload */
    action?: (ctx: Ctx, payload: unknown) => void
}

/**
 * 转移表：以「源状态 → 事件 → 转移」的二维结构声明。
 * 源状态键受 State 泛型约束、事件键受 Event 泛型约束，
 * 因此非法事件名在编译期即被拒绝，运行时只需处理「当前态无该事件」的兜底。
 */
export type TransitionTable<Ctx, S extends string, E extends string> = {
    [From in S]?: { [Ev in E]?: TransitionSpec<Ctx, S> }
}

/** 状态级钩子：进入 / 离开某状态时执行 */
export type StateHook<Ctx> = (ctx: Ctx) => void

/** 机器配置 */
export interface MachineConfig<Ctx, S extends string, E extends string> {
    /** 全部合法状态：用于声明，并在创建时校验 initial 与目标状态 */
    states: readonly S[]
    /** 初始状态 */
    initial: S
    /** 初始 context；省略时视作空对象 */
    context?: Ctx
    /** 转移表 */
    transitions: TransitionTable<Ctx, S, E>
    /** 离开某状态时的钩子（旧态） */
    exit?: Partial<Record<S, StateHook<Ctx>>>
    /** 进入某状态时的钩子（新态） */
    enter?: Partial<Record<S, StateHook<Ctx>>>
}

/** 构造选项 */
export interface MachineOptions {
    /** 非法事件（当前状态下无对应转移）的处理策略：默认 "ignore" */
    onInvalid?: "ignore" | "throw"
}

/** 订阅回调收到的转移信息 */
export interface TransitionInfo<S extends string, E extends string> {
    /** 来源状态 */
    from: S
    /** 目标状态 */
    to: S
    /** 触发事件 */
    event: E
    /** 随事件携带的载荷 */
    payload: unknown
}

export type MachineListener<S extends string, E extends string> = (
    info: TransitionInfo<S, E>,
) => void

/** 状态机对外接口 */
export interface Machine<Ctx, S extends string, E extends string> {
    /** 派发事件：成功转移返回 true；被守卫拦截或按兜底策略忽略时返回 false */
    send(event: E, payload?: unknown): boolean
    /** 预判：当前状态下该事件能否成功转移（会调用 guard，故 guard 应为纯函数） */
    can(event: E, payload?: unknown): boolean
    /** 订阅状态转移，返回取消订阅函数 */
    subscribe(listener: MachineListener<S, E>): () => void
    /** 当前状态 */
    getState(): S
    /** 当前 context（引用稳定，可变更新） */
    getContext(): Ctx
    /** 当前状态是否等于给定状态 */
    matches(state: S): boolean
}

/** 创建时做一次轻量校验：initial 与各转移目标都必须落在 states 内 */
function assertConfig<Ctx, S extends string, E extends string>(
    config: MachineConfig<Ctx, S, E>,
): void {
    const known = new Set<string>(config.states)
    if (!known.has(config.initial)) {
        throw new Error(`非法配置：初始状态 "${config.initial}" 不在 states 中`)
    }
    const entries = Object.entries(config.transitions) as Array<
        [string, Record<string, TransitionSpec<Ctx, S>> | undefined]
    >
    for (const [from, byEvent] of entries) {
        if (!known.has(from)) {
            throw new Error(`非法配置：转移源状态 "${from}" 不在 states 中`)
        }
        for (const [event, spec] of Object.entries(byEvent ?? {})) {
            if (!known.has(spec.target)) {
                throw new Error(`非法配置：事件 "${event}" 的目标状态 "${spec.target}" 不在 states 中`)
            }
        }
    }
}

/**
 * 创建一个有限状态机。
 * 状态与事件均有泛型约束；转移由转移表驱动，成功后依次执行 exit(旧态) → action → enter(新态)。
 */
export function createMachine<Ctx, S extends string, E extends string>(
    config: MachineConfig<Ctx, S, E>,
    options: MachineOptions = {},
): Machine<Ctx, S, E> {
    assertConfig(config)

    const onInvalid = options.onInvalid ?? "ignore"
    let state: S = config.initial
    let context: Ctx = config.context ?? ({} as Ctx)
    const listeners = new Set<MachineListener<S, E>>()

    const lookup = (from: S, event: E): TransitionSpec<Ctx, S> | undefined =>
        config.transitions[from]?.[event]

    const can = (event: E, payload?: unknown): boolean => {
        const spec = lookup(state, event)
        if (!spec) return false
        return spec.guard ? spec.guard(context, payload) : true
    }

    const send = (event: E, payload?: unknown): boolean => {
        const from = state
        const spec = lookup(from, event)
        // 兜底：当前状态没有该事件的转移
        if (!spec) {
            if (onInvalid === "throw") {
                throw new Error(`非法转移：状态 "${from}" 下不存在事件 "${event}"`)
            }
            return false
        }
        // 守卫拦截：不转移、不改状态、不通知订阅者
        if (spec.guard && !spec.guard(context, payload)) return false

        const to = spec.target
        // 动作时序：exit(旧态) → action → enter(新态)
        config.exit?.[from]?.(context)
        spec.action?.(context, payload)
        state = to
        config.enter?.[to]?.(context)

        const info: TransitionInfo<S, E> = { from, to, event, payload }
        // 快照后再遍历：允许回调内部增删订阅而不影响本次派发
        for (const listener of [...listeners]) listener(info)
        return true
    }

    const subscribe = (listener: MachineListener<S, E>): (() => void) => {
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    }

    return {
        send,
        can,
        subscribe,
        getState: () => state,
        getContext: () => context,
        matches: (target: S) => state === target,
    }
}
