// 文件: cases/02-type-safe-event-bus/src/event-bus.ts
// ============ 类型安全的事件总线：泛型约束 + 条件类型 + infer ============

/** 事件表：事件名 -> payload 类型。无参事件把 payload 写成 void */
export type EventMap = Record<string, unknown>

/**
 * 条件类型：由事件 payload 推导 emit 的参数列表。
 * - 无参事件（payload 为 void / undefined）→ 空参数，emit 可省略实参；
 * - 其余事件 → 必须传入一个 payload。
 */
export type EmitArgs<P> = [P] extends [void] ? [] : [payload: P]

/** 借助 infer 从 handler 类型反推 payload 类型（类型体操演示） */
export type PayloadOf<H> = H extends (payload: infer P) => void ? P : never

/** 事件回调签名：参数类型由 Events[K] 推导而来 */
export type EventHandler<E extends EventMap, K extends keyof E> = (payload: E[K]) => void

/** 事件总线对外接口 */
export interface EventBus<E extends EventMap> {
    /** 订阅事件，返回取消订阅函数 */
    on<K extends keyof E>(type: K, handler: EventHandler<E, K>): () => void
    /** 取消订阅 */
    off<K extends keyof E>(type: K, handler: EventHandler<E, K>): void
    /** 订阅一次：首次触发后自动取消 */
    once<K extends keyof E>(type: K, handler: EventHandler<E, K>): () => void
    /** 触发事件；无参事件可省略实参。返回是否存在监听者 */
    emit<K extends keyof E>(type: K, ...args: EmitArgs<E[K]>): boolean
}

/** 内部统一存放的回调形态：对外 API 由泛型约束保证类型安全 */
type RawHandler = (...args: any[]) => void

/**
 * 创建一个类型安全的事件总线。
 * 事件名与 payload 类型由泛型参数 Events 一次性约束，on / off / once / emit 全部据此推导。
 */
export function createEventBus<E extends EventMap = EventMap>(): EventBus<E> {
    const handlers = new Map<keyof E, Set<RawHandler>>()

    /** 取出（或创建）某个事件对应的回调集合 */
    function bucket(type: keyof E): Set<RawHandler> {
        let set = handlers.get(type)
        if (!set) {
            set = new Set()
            handlers.set(type, set)
        }
        return set
    }

    const on: EventBus<E>["on"] = (type, handler) => {
        bucket(type).add(handler)
        // 返回取消订阅函数，等价于手动调用 off
        return () => off(type, handler)
    }

    const off: EventBus<E>["off"] = (type, handler) => {
        const set = handlers.get(type)
        if (!set) return
        set.delete(handler)
        // 集合空了就顺手删掉整个事件，避免内存常驻
        if (set.size === 0) handlers.delete(type)
    }

    const once: EventBus<E>["once"] = (type, handler) => {
        // 用一层包装记录“是否已触发”，触发前先移除自身，保证只执行一次
        const wrapped: RawHandler = (payload) => {
            handlers.get(type)?.delete(wrapped)
            handler(payload)
        }
        bucket(type).add(wrapped)
        return () => handlers.get(type)?.delete(wrapped)
    }

    const emit: EventBus<E>["emit"] = (type, ...args) => {
        const set = handlers.get(type)
        if (!set || set.size === 0) return false
        // 快照一份再遍历：允许回调内部增删订阅而不影响本次派发
        for (const handler of [...set]) handler(...args)
        return true
    }

    return { on, off, once, emit }
}
