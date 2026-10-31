// 文件: examples/46-02-async-capture.ts
// ============ 异步错误捕获:Promise 链的冒泡规则与 unhandledrejection ============
// 设计要点:
// 1) Promise 的拒绝会沿链向下冒泡,直到遇到第一个 .catch 或 try/catch(await);
// 2) 捕获后再次 throw 会生成新的拒绝链,常用于「处理一部分 + 上报后抛给全局兜底」;
// 3) 没有任何 catch 的拒绝,在当前轮微任务清空后触发 unhandledrejection(浏览器)/ unhandledRejection(Node);
// 4) 同一个 Promise 被多处 await,只需要在最顶层处理一次——每处都 catch 反而重复上报。

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 硬断言:不满足即非零退出,让 CI 门禁能真的拦截 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

async function main() {
  // ---- 1. 拒绝沿链冒泡:中间环节不处理,一路到链尾 ----
  await Promise.reject(new Error("源头拒绝"))
    .then(() => console.log("不会执行"))
    .then(() => console.log("也不会执行"))
    .catch((e) => console.log("✓ 1. 链尾捕获到冒泡来的:", e.message));

  // ---- 2. catch 之后继续 throw:处理一半,剩下的交给上层 ----
  const levels: string[] = [];
  await Promise.reject(new Error("接口 500"))
    .catch((e) => {
      levels.push("请求层:转为业务错误");
      throw new Error(`BusinessError: ${e.message}`); // 继续抛,生成新拒绝链
    })
    .catch((e) => {
      levels.push(e.message);
      console.log("✓ 2. 上层兜底:", e.message);
    });
  assert(
    levels[1]?.startsWith("BusinessError") === true,
    "rethrow 应携带新语义",
  );

  // ---- 3. await 的 reject 等价于同步 throw,可以被 try/catch 捕获 ----
  async function fetchUser() {
    throw new Error("网络超时");
  }
  try {
    await fetchUser();
  } catch (e) {
    console.log("✓ 3. try/catch 捕获 await 拒绝:", (e as Error).message);
  }

  // ---- 4. ⚠️ 常见错觉:.then 第二个参数只接上一个环节,接不住「自己回调里」的抛错 ----
  const got: string[] = [];
  await Promise.resolve("data")
    .then(
      () => {
        throw new Error("回调内部抛错");
      },
      (e) => got.push(`onRejected 接到:${(e as Error).message}`), // ❌ 接不到上面回调里的错
    )
    .catch((e) => {
      got.push(`catch 接到:${(e as Error).message}`); // ✅ 链尾 catch 才能接到
    });
  console.log("✓ 4.", got.join(" | "));
  assert(
    got.length === 1 && got[0]?.startsWith("catch") === true,
    "onRejected 接不住同层回调的抛错",
  );

  // ---- 5. 没人接的拒绝 → unhandledrejection(用 Node 的同名事件演示浏览器行为) ----
  const unhandled: string[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(String(reason));
    console.log("✓ 5. 全局兜底触发:", String(reason));
  };
  process.on("unhandledRejection", onUnhandled);

  // 制造一个「这一轮没人接」的拒绝
  void Promise.reject(new Error("没人接的拒绝"));
  await sleep(0); // 等微任务清空、事件触发

  // 补接:事件触发后再 catch 就晚了——拒绝已被标记为 unhandled
  assert(unhandled.length === 1, "无兜底的拒绝必须触发全局事件");

  // ---- 6. 迟到的 catch:只要在「事件触发前」挂上,就不算未处理 ----
  const late: string[] = [];
  const lateHandler = (reason: unknown) => late.push(String(reason));
  process.on("unhandledRejection", lateHandler);
  const lazy = Promise.reject(new Error("迟到的 catch"));
  await lazy.catch((e) =>
    console.log("✓ 6. 同一 tick 内补上 catch:", e.message),
  );
  await sleep(0);
  assert(late.length === 0, "同一 tick 内挂 catch 不应触发全局事件");

  process.off("unhandledRejection", onUnhandled);
  process.off("unhandledRejection", lateHandler);
  console.log("\n全部断言通过:异步捕获规则已厘清");
}

main().catch((e) => {
  console.error("示例自身出错:", e);
  process.exit(1);
});
