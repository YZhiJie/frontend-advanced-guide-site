// 文件: cases/06-request-layer-lab/src/backoff.ts
// ============ 指数退避 + full-jitter 抖动：与具体请求解耦，可独立测试 ============

/** 等待函数签名；默认实现走真实 setTimeout，测试可注入以便零等待 */
export type SleepFn = (ms: number) => Promise<void>

/** 默认等待实现：真实定时器 */
export const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 退避参数 */
export interface BackoffConfig {
    /** 退避基数（毫秒） */
    baseDelay: number
    /** 单次延迟上限（毫秒） */
    maxDelay: number
    /** 随机源，默认 Math.random；注入固定值即可让测试确定化 */
    random: () => number
}

/**
 * full-jitter 退避公式（AWS 推荐）：
 *   cap   = min(maxDelay, baseDelay * 2^attempt)
 *   delay = random() * cap
 *
 * 与「固定倍数退避」相比，延迟不再是确定点，而是均匀落在 [0, cap) 内，
 * 能把同一时刻一起失败的大量重试打散，避免惊群（thundering herd）。
 *
 * attempt 从 0 计：首次失败后 cap = baseDelay，之后每失败一次翻倍，
 * 直到被 maxDelay 封顶，防止延迟无限膨胀。
 */
export function fullJitterDelay(attempt: number, config: BackoffConfig): number {
    const exponential = config.baseDelay * 2 ** attempt
    const cap = Math.min(config.maxDelay, exponential)
    return Math.floor(config.random() * cap)
}

/** 重试参数 */
export interface RetryOptions extends BackoffConfig {
    /** 首次尝试之外的最大重试次数（总尝试次数 = retries + 1） */
    retries: number
    /** 等待函数 */
    sleep: SleepFn
    /** 外部取消探测：返回 true 时立即停止重试并抛出最后一次错误 */
    isAborted?: () => boolean
    /** 每次重试前的回调，便于记录延迟 */
    onRetry?: (error: unknown, attempt: number, delay: number) => void
}

/**
 * 带指数退避的重试执行器。
 * task(attempt) 代表「一次完整尝试」，每次调用都应自带超时/取消语义。
 * 成功即返回；失败则按 full-jitter 抖动等待后重试，直到用完 retries 或外部取消。
 */
export async function withRetry<T>(
    task: (attempt: number) => Promise<T>,
    options: RetryOptions,
): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await task(attempt)
        } catch (error) {
            // 外部已取消（例如调用方 abort）时不再重试，把错误原样抛回
            if (options.isAborted?.()) throw error
            if (attempt >= options.retries) throw error
            const delay = fullJitterDelay(attempt, options)
            options.onRetry?.(error, attempt, delay)
            await options.sleep(delay)
        }
    }
}
