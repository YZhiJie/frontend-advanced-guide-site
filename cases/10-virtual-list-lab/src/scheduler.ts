// 文件: cases/10-virtual-list-lab/src/scheduler.ts
// ============ 帧调度器：注入式 rAF，同帧合并、去重保序，支持手动 flush / cancel ============

/** rAF 签名：接收一帧回调并返回句柄（测试可注入假实现，让调度完全离线确定） */
export type RafFn = (callback: () => void) => number

export interface FrameScheduler {
    /** 登记回调：同一帧内重复登记同一函数只执行一次，执行顺序按首次登记顺序 */
    schedule(callback: () => void): void
    /** 立即执行当前待办，并作废已注册的帧回调（便于测试与强制刷新） */
    flush(): void
    /** 丢弃当前待办，且让已注册的帧回调失效 */
    cancel(): void
    /** 当前待执行的回调数量 */
    pendingCount(): number
}

export function createFrameScheduler(raf: RafFn): FrameScheduler {
    /** 帧内待执行集合：Set 天然去重且保序 */
    let queue = new Set<() => void>()
    /** 是否已注册一个帧回调（同一帧内只注册一次） */
    let scheduled = false
    /** 代际令牌：flush/cancel 后自增，使此前注册的帧回调失效，防止其提前执行下一批 */
    let generation = 0

    const drain = (): void => {
        const batch = queue
        queue = new Set<() => void>()
        for (const callback of batch) callback()
    }

    const invalidate = (): void => {
        scheduled = false
        generation += 1
    }

    const runFrame = (token: number): void => {
        // 令牌不匹配说明该帧回调已被 flush/cancel 作废，直接忽略
        if (token !== generation) return
        scheduled = false
        drain()
    }

    const schedule = (callback: () => void): void => {
        if (queue.has(callback)) return
        queue.add(callback)
        if (!scheduled) {
            scheduled = true
            const token = generation
            raf(() => runFrame(token))
        }
    }

    const flush = (): void => {
        if (queue.size === 0) return
        invalidate()
        drain()
    }

    const cancel = (): void => {
        queue = new Set<() => void>()
        invalidate()
    }

    return { schedule, flush, cancel, pendingCount: () => queue.size }
}
