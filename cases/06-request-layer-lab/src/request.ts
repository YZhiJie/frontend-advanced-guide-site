// 文件: cases/06-request-layer-lab/src/request.ts
// ============ 手写请求层：TTL 缓存 + 并发去重 + 指数退避重试 + 超时/取消 + 竞态最新胜出 ============

import { withRetry, realSleep } from "./backoff.js"
import type { SleepFn } from "./backoff.js"

/** 传给 fetcher 的单次请求选项 */
export interface FetchOptions {
    /** 合并后的取消信号（调用方 signal 与内部超时信号二合一） */
    signal?: AbortSignal
}

/**
 * 可注入的取数函数：由使用方决定底层用什么发请求。
 * 测试里注入假 fetcher，因此整个过程离线、不发真实网络请求。
 */
export type Fetcher<T> = (key: string, options: FetchOptions) => Promise<T>

/** 请求超时错误 */
export class RequestTimeoutError extends Error {
    override name = "RequestTimeoutError"
}

/** 请求级选项 */
export interface RequestOptions {
    /** 调用方取消信号 */
    signal?: AbortSignal
    /** 跳过缓存并强制发起新请求（会开启新一轮「竞态代际」） */
    force?: boolean
}

/** 客户端配置 */
export interface ClientOptions<T> {
    /** 必填：底层取数函数 */
    fetcher: Fetcher<T>
    /** 缓存有效期（毫秒），默认 30000 */
    ttl?: number
    /** 首次尝试之外的重试次数，默认 2 */
    retries?: number
    /** 退避基数（毫秒），默认 100 */
    baseDelay?: number
    /** 单次退避延迟上限（毫秒），默认 10000 */
    maxDelay?: number
    /** 超时（毫秒），默认 0 表示不限时 */
    timeout?: number
    /** 可注入的等待函数，默认真实 setTimeout；测试注入空实现以避免真实等待 */
    sleep?: SleepFn
    /** 可注入的随机源，默认 Math.random；注入固定值可让退避延迟确定化 */
    random?: () => number
    /** 可注入的时钟，默认 Date.now；用于测试 TTL 过期 */
    now?: () => number
}

/** 对外暴露的客户端 */
export interface Client<T> {
    /** 发起请求：命中缓存/命中 in-flight 都直接返回 */
    request(key: string, options?: RequestOptions): Promise<T>
    /** 手动失效单个 key 的缓存 */
    invalidate(key: string): void
    /** 清空全部缓存 */
    clear(): void
    /** 当前缓存条目数（便于测试观察） */
    readonly size: number
    /** 当前仍在飞行的请求数（便于测试观察去重与清理） */
    readonly pending: number
}

/** 合并多个 AbortSignal；优先用原生 AbortSignal.any，缺失时手写回退 */
function combineSignals(signals: AbortSignal[]): AbortSignal {
    const anyFn = (AbortSignal as unknown as { any?: (list: AbortSignal[]) => AbortSignal }).any
    if (anyFn) return anyFn(signals)

    const controller = new AbortController()
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason)
            break
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true })
    }
    return controller.signal
}

/**
 * 创建一个请求层客户端。
 * 缓存、去重、重试、超时、竞态全部在内部完成，对外只需关心 request / invalidate / clear。
 */
export function createClient<T>(options: ClientOptions<T>): Client<T> {
    const fetcher = options.fetcher
    const ttl = options.ttl ?? 30_000
    const retries = options.retries ?? 2
    const baseDelay = options.baseDelay ?? 100
    const maxDelay = options.maxDelay ?? 10_000
    const timeout = options.timeout ?? 0
    const sleep = options.sleep ?? realSleep
    const random = options.random ?? Math.random
    const now = options.now ?? Date.now

    interface CacheEntry {
        value: T
        /** 过期时间戳（毫秒） */
        expiresAt: number
    }
    interface InflightEntry {
        promise: Promise<T>
        /** 该请求所属的「代际」版本号 */
        version: number
    }

    const cache = new Map<string, CacheEntry>()
    const inflight = new Map<string, InflightEntry>()
    /**
     * 每个 key 的当前代际。每次「非去重」的新请求都会自增并占位，
     * 请求返回时只有代际仍等于自己才允许写缓存 —— 这就是「最新胜出」的校验点。
     */
    const versions = new Map<string, number>()
    let versionSeq = 0

    /** 单次尝试：新建 AbortController，叠加超时，再调用 fetcher */
    async function attemptOnce(key: string, callerSignal?: AbortSignal): Promise<T> {
        const controller = new AbortController()
        // 调用方 signal 与本次内部超时 signal 合并后交给 fetcher
        const signal = callerSignal ? combineSignals([callerSignal, controller.signal]) : controller.signal
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            if (timeout > 0) {
                const timeoutPromise = new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => {
                        const error = new RequestTimeoutError(`请求 ${key} 超时（>${timeout}ms）`)
                        // 主动 abort，让下游 fetcher 也能尽早释放资源
                        controller.abort(error)
                        reject(error)
                    }, timeout)
                })
                return await Promise.race([fetcher(key, { signal }), timeoutPromise])
            }
            return await fetcher(key, { signal })
        } finally {
            // fetcher 先完成（或被超时打断）后都要清掉定时器，避免悬挂
            if (timer !== undefined) clearTimeout(timer)
        }
    }

    /** 带重试的一次取数：每次 attemptOnce 都重建超时控制器，互不干扰 */
    function fetchWithRetry(key: string, callerSignal?: AbortSignal): Promise<T> {
        return withRetry(() => attemptOnce(key, callerSignal), {
            retries,
            baseDelay,
            maxDelay,
            random,
            sleep,
            isAborted: () => callerSignal?.aborted ?? false,
        })
    }

    /** 开启一次全新的（非去重）请求，登记代际并托管 in-flight */
    function start(key: string, requestOptions: RequestOptions): Promise<T> {
        const version = ++versionSeq
        versions.set(key, version)

        const promise = (async () => {
            const value = await fetchWithRetry(key, requestOptions.signal)
            // 竞态校验：期间若被 force 请求顶替（代际变了），旧结果不得写缓存
            if (versions.get(key) === version) {
                cache.set(key, { value, expiresAt: now() + ttl })
            }
            return value
        })()

        const entry: InflightEntry = { promise, version }
        inflight.set(key, entry)
        // 完成（无论成功失败）都要移出 in-flight，且只清理「仍属于自己的那一条」
        const cleanup = (): void => {
            if (inflight.get(key) === entry) inflight.delete(key)
        }
        void promise.then(cleanup, cleanup)
        return promise
    }

    return {
        request(key: string, requestOptions: RequestOptions = {}): Promise<T> {
            const entry = cache.get(key)
            // 1) 缓存命中：未过期且未强制刷新
            if (!requestOptions.force && entry && entry.expiresAt > now()) {
                return Promise.resolve(entry.value)
            }
            // 2) 并发去重：同 key 已有在飞请求则共享同一 Promise（fetcher 只跑一次）
            if (!requestOptions.force) {
                const existing = inflight.get(key)
                if (existing) return existing.promise
            }
            // 3) 否则开启新请求
            return start(key, requestOptions)
        },
        invalidate(key: string): void {
            cache.delete(key)
        },
        clear(): void {
            cache.clear()
        },
        get size(): number {
            return cache.size
        },
        get pending(): number {
            return inflight.size
        },
    }
}
