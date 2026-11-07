// 文件: examples/46-03-multi-task-errors.ts
// ============ 多异步任务的错误编排:短路 / 汇总 / 并发池 / 补偿 ============
// 设计要点:
// 1) Promise.all 是「短路」的:第一个拒绝即整体失败,但其余任务仍在后台执行(请求不会自动取消);
// 2) Promise.allSettled 永远等所有人落定,适合「仪表盘多卡片」这类部分失败也要展示的场景;
// 3) 并发池要决定错误策略:收集模式(继续跑完)vs 熔断模式(第一个错就停);
// 4) 多步骤流程(下单→扣库存→支付)失败时要反向补偿,前端的职责是把每一步的撤销动作登记好。

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 硬断言:不满足即非零退出,让 CI 门禁能真的拦截 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const task = (name: string, ms: number, fail = false) =>
  sleep(ms).then(() => {
    if (fail) throw new Error(`${name} 失败`);
    return `${name} 完成`;
  });

async function main() {
  // ---- 1. Promise.all 短路:第一个失败立即落定,其余任务「失控地继续」 ----
  const finished: string[] = [];
  const tracked = (name: string, ms: number, fail = false) =>
    task(name, ms, fail).finally(() => finished.push(name)); // finally 观察谁真的跑完了
  const allResult = await Promise.all([
    tracked("快失败", 10, true),
    tracked("慢成功", 50),
  ]).catch((e) => `整体失败:${(e as Error).message}`);
  // 此刻 all 已落定(10ms),但「慢成功」还在后台跑——等它走完再观察
  console.log("✓ 1. all 结果:", allResult, "| 此刻已跑完:", finished);
  await sleep(60);
  console.log("    60ms 后再看:", finished);
  assert(finished.length === 2, "all 短路后其余任务仍会继续执行");
  // ⚠️ 想让「短路时取消在途请求」,必须配合 AbortController,见 6.5 节

  // ---- 2. allSettled 汇总:成功失败分开记账,一次出完整报告 ----
  const settled = await Promise.allSettled([
    task("头像", 10),
    task("订单", 20, true),
    task("消息", 15),
  ]);
  const report = {
    ok: settled
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<string>).value),
    fail: settled
      .filter((r) => r.status === "rejected")
      .map((r) => (r as PromiseRejectedResult).reason.message as string),
  };
  console.log("✓ 2. allSettled 报告:", JSON.stringify(report));
  assert(
    report.ok.length === 2 && report.fail.length === 1,
    "allSettled 必须等全部落定",
  );

  // ---- 3. 并发池的错误策略:收集模式(跑完全部,失败记账) ----
  async function asyncPool<T, R>(
    limit: number,
    items: readonly T[],
    worker: (item: T, index: number) => Promise<R>,
  ): Promise<Array<{ ok: true; value: R } | { ok: false; error: Error }>> {
    const results: Array<{ ok: true; value: R } | { ok: false; error: Error }> =
      new Array(items.length);
    let cursor = 0;
    async function runner() {
      while (cursor < items.length) {
        const i = cursor++;
        try {
          results[i] = { ok: true, value: await worker(items[i] as T, i) };
        } catch (e) {
          results[i] = { ok: false, error: e as Error }; // ✅ 失败记账,不中断其他任务
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, () => runner()),
    );
    return results;
  }

  const poolResults = await asyncPool(2, [1, 2, 3, 4, 5], (n) =>
    task(`任务${n}`, 10, n === 3),
  );
  const failedCount = failedCountOf(poolResults);
  console.log(
    "✓ 3. 并发池收集模式:5 个任务,失败",
    failedCount,
    "个,其余全部跑完",
  );
  assert(failedCount === 1, "并发池收集模式应跑完全部任务");

  function failedCountOf<R>(rs: Array<{ ok: boolean; value?: R }>) {
    return rs.filter((r) => !r.ok).length;
  }

  // ---- 4. 熔断模式:第一个错就停(导入场景:一条坏数据=整批作废) ----
  async function failFast<T>(
    items: readonly T[],
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    for (const item of items) {
      await worker(item); // 串行 + 不吞错,第一个失败直接中断
    }
  }
  const done: number[] = [];
  await failFast([1, 2, 3, 4], async (n) => {
    if (n === 3) throw new Error("第 3 条数据坏了");
    done.push(n);
  }).catch((e) => console.log("✓ 4. 熔断于:", (e as Error).message));
  assert(done.join(",") === "1,2", "熔断后不再处理后续数据");

  // ---- 5. 多步骤流程的补偿(Saga 简化版):每前进一步,登记一个撤销动作 ----
  class Saga {
    private compensations: Array<() => Promise<void>> = [];
    async step<T>(
      action: () => Promise<T>,
      compensate: () => Promise<void>,
    ): Promise<T> {
      const result = await action(); // 失败时由外层触发 runCompensations
      this.compensations.unshift(compensate); // ✅ 逆序:后做的先撤销
      return result;
    }
    async runCompensations() {
      for (const c of this.compensations) {
        await c().catch((e) =>
          console.error("  补偿自身失败(需告警):", e.message),
        );
      }
    }
  }

  const ledger: string[] = [];
  const saga = new Saga();
  try {
    await saga.step(
      async () => {
        ledger.push("创建订单");
      },
      async () => {
        ledger.push("撤销订单");
      },
    );
    await saga.step(
      async () => {
        ledger.push("扣减库存");
      },
      async () => {
        ledger.push("回补库存");
      },
    );
    await saga.step(
      async () => {
        throw new Error("支付超时");
      },
      async () => {
        ledger.push("退回支付");
      },
    );
  } catch (e) {
    console.log("✓ 5. 流程中断:", (e as Error).message, "→ 开始反向补偿");
    await saga.runCompensations();
  }
  console.log("  账本:", ledger.join(" → "));
  assert(
    ledger.join(",") === "创建订单,扣减库存,回补库存,撤销订单",
    "补偿必须按逆序执行",
  );

  console.log("\n全部断言通过:多任务错误编排已厘清");
}

main().catch((e) => {
  console.error("示例自身出错:", e);
  process.exit(1);
});
