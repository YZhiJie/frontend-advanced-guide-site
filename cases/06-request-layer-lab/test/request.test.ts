// 文件: cases/06-request-layer-lab/test/request.test.ts
// ============ 请求层逐项回归：缓存 / 去重 / 重试 / 超时取消 / 竞态 ============

import { test } from "node:test"
import assert from "node:assert/strict"
import { createClient, RequestTimeoutError } from "../src/request.js"
import { fullJitterDelay } from "../src/backoff.js"
import type { Fetcher } from "../src/request.js"

/** 手动可控的 Promise：测试里用它精确编排请求完成顺序 */
function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

/** 永不主动完成的 fetcher：只在收到 abort 时拒绝，用来观测超时/取消链路 */
const abortAwareFetcher: Fetcher<never> = (_key, { signal }) =>
    new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
    })

test("fullJitterDelay 按 cap=min(maxDelay, base*2^attempt) 计算", () => {
    const config = { baseDelay: 100, maxDelay: 1000, random: () => 1 }
    assert.equal(fullJitterDelay(0, config), 100)
    assert.equal(fullJitterDelay(1, config), 200)
    assert.equal(fullJitterDelay(2, config), 400)
    // 超过上限后被 maxDelay 封顶
    assert.equal(fullJitterDelay(10, config), 1000)
    // 随机源为 0 时延迟下限为 0
    assert.equal(fullJitterDelay(3, { ...config, random: () => 0 }), 0)
})

test("TTL 内命中缓存，过期后重新请求（边界值 now === expiresAt 视为过期）", async () => {
    let clock = 0
    let calls = 0
    const client = createClient<string>({
        fetcher: async () => `v${++calls}`,
        ttl: 100,
        now: () => clock,
    })

    assert.equal(await client.request("k"), "v1")
    assert.equal(calls, 1)

    clock = 50
    assert.equal(await client.request("k"), "v1") // 命中缓存，value 为同一引用
    assert.equal(calls, 1)

    clock = 100 // expiresAt = 0 + 100，恰好等于当前时间 -> 过期
    assert.equal(await client.request("k"), "v2")
    assert.equal(calls, 2)
})

test("手动失效与清空缓存", async () => {
    let calls = 0
    const client = createClient<number>({
        fetcher: async () => ++calls,
        ttl: 1000,
        now: () => 0,
    })

    assert.equal(await client.request("a"), 1)
    assert.equal(await client.request("b"), 2)
    assert.equal(client.size, 2)

    client.invalidate("a")
    assert.equal(client.size, 1)
    assert.equal(await client.request("a"), 3) // a 重新取数
    assert.equal(await client.request("b"), 2) // b 仍命中缓存

    client.clear()
    assert.equal(client.size, 0)
})

test("并发去重：同 key 并发请求共享同一 in-flight Promise，fetcher 只被调用一次", async () => {
    let calls = 0
    const gate = deferred<number>()
    const client = createClient<number>({
        fetcher: () => {
            calls++
            return gate.promise
        },
    })

    const p1 = client.request("k")
    const p2 = client.request("k")
    assert.equal(p1, p2) // 同一 Promise
    assert.equal(client.pending, 1)
    assert.equal(calls, 1)

    gate.resolve(1)
    assert.equal(await p1, 1)
    assert.equal(await p2, 1)
    assert.equal(calls, 1)
    // 完成后移出 in-flight，并写入缓存
    assert.equal(client.pending, 0)
    assert.equal(client.size, 1)
})

test("重试：失败按 full-jitter 退避，成功即止", async () => {
    let calls = 0
    const delays: number[] = []
    const client = createClient<string>({
        fetcher: async () => {
            calls++
            if (calls < 3) throw new Error(`失败${calls}`)
            return "ok"
        },
        retries: 5,
        baseDelay: 100,
        maxDelay: 1000,
        random: () => 1,
        sleep: async (ms) => {
            delays.push(ms)
        },
    })

    assert.equal(await client.request("k"), "ok")
    assert.equal(calls, 3) // 第 3 次成功，之后不再重试
    assert.deepEqual(delays, [100, 200]) // full-jitter：base*2^0、base*2^1
})

test("重试耗尽后抛出最后一次错误", async () => {
    let calls = 0
    const delays: number[] = []
    const client = createClient<string>({
        fetcher: async () => {
            calls++
            throw new Error(`失败${calls}`)
        },
        retries: 2,
        baseDelay: 100,
        maxDelay: 1000,
        random: () => 1,
        sleep: async (ms) => {
            delays.push(ms)
        },
    })

    await assert.rejects(client.request("k"), /失败3/)
    assert.equal(calls, 3) // retries=2 -> 共 3 次尝试
    assert.deepEqual(delays, [100, 200])
})

test("超时：超过 timeout 抛出 RequestTimeoutError", async () => {
    const client = createClient<never>({
        fetcher: abortAwareFetcher,
        timeout: 20,
        retries: 0, // 超时用例不重试，保持快速确定
    })

    await assert.rejects(client.request("k"), (error: unknown) => {
        assert.ok(error instanceof RequestTimeoutError)
        assert.match((error as Error).message, /超时/)
        return true
    })
})

test("调用方可取消：abort 后立即抛错且不重试", async () => {
    let calls = 0
    const controller = new AbortController()
    const client = createClient<never>({
        fetcher: (_key, opts) => {
            calls++
            return abortAwareFetcher(_key, opts)
        },
        timeout: 0,
        retries: 3,
    })

    const pending = client.request("k", { signal: controller.signal })
    controller.abort(new Error("用户取消"))

    await assert.rejects(pending, /用户取消/)
    assert.equal(calls, 1) // 取消后不再重试
    assert.equal(client.pending, 0) // 失败也要移出 in-flight
})

test("竞态最新胜出：旧请求结果不得覆盖被 force 顶替的新请求", async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    let calls = 0
    const client = createClient<string>({
        fetcher: () => (++calls === 1 ? first.promise : second.promise),
        ttl: 1000,
        now: () => 0,
    })

    const oldRequest = client.request("k")
    const newRequest = client.request("k", { force: true }) // 顶替，开启新代际
    assert.equal(calls, 2)

    second.resolve("new")
    assert.equal(await newRequest, "new")

    // 旧请求此刻才返回；它仍能把结果交给自己的调用方……
    first.resolve("old")
    assert.equal(await oldRequest, "old")

    // ……但代际已变，旧结果绝不允许写回缓存
    assert.equal(await client.request("k"), "new")
})
