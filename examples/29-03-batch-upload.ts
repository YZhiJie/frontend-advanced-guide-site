// 文件: examples/29-03-batch-upload.ts
// ============ 批量聚合上传：双阈值攒批 + 空窗过滤 + 并发上限 + 整批重试不拖垮 ============
// 把 29.5「实战案例：批量聚合上传」落成可执行代码，操作符编排与正文逐行同构：
//   bufferTime(flushMs, null, maxBatch)   —— 超时 flush 与攒满 flush 一个操作符表达
//   filter(len > 0)                       —— 空窗口不发起「空气请求」
//   mergeMap(upload → retry → catchError, concurrent) —— 并发上限 + 整批重试 + 失败丢弃
// 与正文的唯一差异：upload 返回 Observable 而非 Promise（from() 对两者一视同仁），
// 另加两个插桩钩子 onStart/onSettled——生产侧本来就要接指标上报，这里用来断言并发数。
// 被验证的硬性质：
// - 超时窗口与攒满条数都会触发 flush，空窗口被过滤；
// - 慢上传 + 事件洪峰时在飞请求数永远不超过 concurrent；
// - 单批失败重试 2 次后丢弃并计数，后续批次照常上传，流不终结。

import { defer, from, of, Subject, timer, type Observable } from "rxjs";
import { bufferTime, catchError, filter, finalize, mergeMap, retry } from "rxjs/operators";
import { TestScheduler } from "rxjs/testing";

/** 硬断言：console.assert 在 Node 里不阻断，脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

interface TrackEvent {
  name: string;
}

interface BatchUploaderOptions {
  flushMs?: number;
  maxBatch?: number;
  concurrent?: number;
  retryDelayMs?: number;
  /** 批次获得并发槽、开始上传（生产接指标，测试数在飞数） */
  onStart?: (batch: TrackEvent[]) => void;
  /** 批次无论成功/丢弃都落定（finalize 保证恰好一次） */
  onSettled?: (batch: TrackEvent[]) => void;
}

// ---------------- 被测实现：与正文 29.5 同构 ----------------

function createBatchUploader(
  upload: (batch: TrackEvent[]) => Observable<void>,
  options: BatchUploaderOptions = {},
) {
  const flushMs = options.flushMs ?? 3000;
  const maxBatch = options.maxBatch ?? 20;
  const concurrent = options.concurrent ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const events$ = new Subject<TrackEvent>();

  events$.pipe(
    // 最长攒 flushMs 或攒满 maxBatch 条就 flush 一批
    bufferTime(flushMs, null, maxBatch),
    // bufferTime 到点必 flush，空窗口会产出空数组，不过滤就是周期性空气请求
    filter((batch) => batch.length > 0),
    mergeMap(
      (batch) => {
        options.onStart?.(batch);
        // defer 让每次重试都重新调用 upload，与真实 fetch 语义一致
        return defer(() => upload(batch)).pipe(
          retry({ count: 2, delay: () => timer(retryDelayMs) }),
          catchError(() => of(null)), // 重试仍失败：丢弃本批，不许拖垮整条上传流
          finalize(() => options.onSettled?.(batch)),
        );
      },
      concurrent, // 并发生命线：上游一旦积压，没有上限会瞬间打满连接池
    ),
  ).subscribe();

  return {
    push: (event: TrackEvent) => events$.next(event),
    /** 页面卸载收口：补发残余批次并让 bufferTime 停止开窗 */
    close: () => events$.complete(),
  };
}

// ---------------- 测试夹具 ----------------

const makeScheduler = () =>
  new TestScheduler((actual, expected) => {
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      `断言数据不符\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`,
    );
  });

const ev = (name: string): TrackEvent => ({ name });

// ---------------- 场景 A：超时/攒满双阈值 flush，空窗口不发起请求 ----------------

{
  const ts = makeScheduler();
  ts.run(({ cold, hot, flush }) => {
    const started: Array<{ f: number; names: string[] }> = [];
    const upload = (batch: TrackEvent[]): Observable<void> => {
      started.push({ f: ts.now(), names: batch.map((e) => e.name) });
      return cold("--|");
    };

    const uploader = createBatchUploader(upload, { flushMs: 4, maxBatch: 3 });

    // w1 [f0,f4)：a@1,b@2 → 超时 flush@f4 得 [a,b]
    // w2 [f4,f8)：c@5,d@6,e@7 → f7 攒满 3 条提前 flush 得 [c,d,e]
    //   （bufferCreationInterval 为 null 时 restartOnEmit：提前 flush 后窗口从 f7 重新计时）
    // w3 [f7,f11)：f@9 → 超时 flush@f11 得 [f]；其余空窗口应被 filter 吞掉
    const input$ = hot("-ab--cde-f-------|", {
      a: ev("a"), b: ev("b"), c: ev("c"), d: ev("d"), e: ev("e"), f: ev("f"),
    });
    input$.subscribe({ next: uploader.push, complete: uploader.close });
    flush();

    assert(started.length === 3, `应上传 3 批，实际 ${started.length} 批`);
    assert(started[0].f === 4 && started[0].names.join("") === "ab",
      `首批应为 f4 [a,b]，实际 ${JSON.stringify(started[0])}`);
    assert(started[1].f === 7 && started[1].names.join("") === "cde",
      `次批应为 f7 攒满提前 flush [c,d,e]，实际 ${JSON.stringify(started[1])}`);
    assert(started[2].f === 11 && started[2].names.join("") === "f",
      `末批应为 f11 [f]，实际 ${JSON.stringify(started[2])}`);
    assert(started.every((b) => b.names.length > 0), "空窗口不应产生上传");
  });
  console.log("✓ 场景 A：超时/攒满双阈值生效，空窗口零请求");
}

// ---------------- 场景 B：慢上传 + 事件洪峰，在飞请求永不超 concurrent ----------------

{
  const ts = makeScheduler();
  ts.run(({ cold, hot, flush }) => {
    let inFlight = 0;
    let maxInFlight = 0;
    const settled: Array<{ f: number; names: string[] }> = [];
    const upload = (_batch: TrackEvent[]): Observable<void> => cold("----|"); // 5 帧慢上传

    const uploader = createBatchUploader(upload, {
      flushMs: 2,
      maxBatch: 10,
      concurrent: 2,
      onStart: () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
      },
      onSettled: (batch) => {
        inFlight -= 1;
        settled.push({ f: ts.now(), names: batch.map((e) => e.name) });
      },
    });

    // 每帧 1 个事件，每 2 帧攒出 1 批，连攒 4 批；上传要 5 帧，天然积压
    // 边界语义：f2/f4/f6/f8 的事件与关窗同帧，落进「正在关闭」的那个窗口
    // （注意：marble 的 (ab) 分组括号本身也占帧，此处用逐帧单字符最直白）
    const input$ = hot("-abcdefgh|", {
      a: ev("a"), b: ev("b"), c: ev("c"), d: ev("d"),
      e: ev("e"), f: ev("f"), g: ev("g"), h: ev("h"),
    });
    input$.subscribe({ next: uploader.push, complete: uploader.close });
    flush();

    assert(settled.length === 4, `4 批应全部落定，实际 ${settled.length}`);
    assert(maxInFlight === 2, `在飞峰值应被压在 2，实际冲到 ${maxInFlight}`);
    // b1 f2→f6，b2 f4→f8，b3 等 b1 让位 f6→f10，b4 等 b2 让位 f8→f12
    assert(
      settled.map((s) => s.f).join(",") === "6,8,10,12",
      `落定帧应为 6,8,10,12，实际 ${settled.map((s) => s.f).join(",")}`,
    );
  });
  console.log("✓ 场景 B：并发上限 2 在洪峰下严格成立，批次排队让位");
}

// ---------------- 场景 C：单批失败重试 2 次后丢弃，后续批次照常上传 ----------------

{
  const ts = makeScheduler();
  ts.run(({ cold, hot, flush }) => {
    const attempts: Array<{ f: number; names: string[] }> = [];
    const dropped: Array<{ f: number; names: string[] }> = [];
    const settledOk: string[] = [];

    const uploader = createBatchUploader(
      (batch) => {
        attempts.push({ f: ts.now(), names: batch.map((e) => e.name) });
        return batch.some((e) => e.name === "bad")
          ? cold("#", {}, new Error("HTTP 500"))
          : cold("-|");
      },
      {
        flushMs: 2,
        retryDelayMs: 2,
        onSettled: (batch) => {
          if (!batch.some((e) => e.name === "bad")) {
            settledOk.push(batch.map((e) => e.name).join(""));
          } else {
            dropped.push({ f: ts.now(), names: batch.map((e) => e.name) });
          }
        },
      },
    );

    // [g1]@f2 成功；[bad]@f4 三次尝试(f4/f6/f8)全败 → f8 丢弃；[g2]@f6 照常成功
    const input$ = hot("-a-b-c-----|", { a: ev("g1"), b: ev("bad"), c: ev("g2") });
    input$.subscribe({ next: uploader.push, complete: uploader.close });
    flush();

    const badAttempts = attempts.filter((a) => a.names.includes("bad"));
    assert(badAttempts.length === 3, `失败批应尝试 1+2=3 次，实际 ${badAttempts.length} 次`);
    assert(badAttempts.map((a) => a.f).join(",") === "4,6,8",
      `重试间隔应为 2 帧(4,6,8)，实际 ${badAttempts.map((a) => a.f).join(",")}`);
    assert(dropped.length === 1 && dropped[0].f === 8,
      `失败批应在 f8 被丢弃，实际 ${JSON.stringify(dropped)}`);
    assert(settledOk.join(",") === "g1,g2", `正常批应全部上传，实际 ${settledOk.join(",")}`);
  });
  console.log("✓ 场景 C：失败批重试 2 次后单独丢弃，上传流不终结");
}

console.log("\n全部断言通过：双阈值攒批、空窗过滤、并发上限、整批重试降级");
