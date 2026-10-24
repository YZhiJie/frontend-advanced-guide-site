// 文件: examples/ai-interview/mcp-retry.ts —— MCP 远程调用：全抖动退避重试 + 熔断
// 运行方式: npx tsx examples/ai-interview/mcp-retry.ts（自带演示 main）
// 关联文档: 21-frontend-ai-interview.md 21.4.4
interface RetryPolicy {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
}

interface MaybeCodeError {
  code?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 全抖动延迟：min(maxMs, baseMs × 2ⁿ) 上随机，防断网恢复时大量客户端同时重连打爆网关 */
const fullJitterDelay = (attempt: number, p: RetryPolicy): number =>
  Math.random() * Math.min(p.maxMs, p.baseMs * 2 ** attempt);

// 只有「可重试错误」才重试：网络故障 / 5xx / JSON-RPC -32603 内部错误 / -32700 解析错误
// -32602 参数非法、-32601 方法不存在是确定性错误，重试永远不会成功，应立即失败
const RETRYABLE_CODES = new Set([-32700, -32603]);

/** 简单熔断器：连续失败到阈值后短路 30s，给故障 Server 喘息，失败快速暴露给 UI */
class CircuitBreaker {
  failures = 0;
  openedUntil = 0;

  get open(): boolean {
    return Date.now() < this.openedUntil;
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= 5) this.openedUntil = Date.now() + 30_000;
  }
}

const defaultPolicy: RetryPolicy = { maxAttempts: 4, baseMs: 200, maxMs: 5000 };

export async function callMCPWithResilience<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = defaultPolicy,
  breaker: CircuitBreaker = new CircuitBreaker(),
): Promise<T> {
  if (breaker.open) throw new Error("MCP Server 熔断中，稍后再试");

  let attempt = 0;
  for (;;) {
    try {
      const out = await fn();
      breaker.recordSuccess();
      return out;
    } catch (err) {
      attempt += 1;
      const code = (err as MaybeCodeError).code;
      const retryable = code === undefined || RETRYABLE_CODES.has(code);
      if (attempt >= policy.maxAttempts || !retryable) {
        if (retryable) breaker.recordFailure();
        throw err;
      }
      await sleep(fullJitterDelay(attempt - 1, policy));
    }
  }
}

// ---- 演示：前 2 次抛内部错误（可重试），第 3 次成功 ----
async function main(): Promise<void> {
  let calls = 0;
  const flaky = async (): Promise<string> => {
    calls += 1;
    if (calls < 3) {
      const err: Error & MaybeCodeError = new Error("remote 500");
      err.code = -32603;
      throw err;
    }
    return "订单已揽件";
  };
  const result = await callMCPWithResilience(flaky, {
    maxAttempts: 5,
    baseMs: 50,
    maxMs: 500,
  });
  console.log(`第 ${calls} 次调用成功：${result}`); // 第 3 次调用成功：订单已揽件
}

main();
