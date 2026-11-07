// 文件: examples/29-04-drag-frames.ts
// ============ 拖拽动画：帧主时钟 + withLatestFrom 采样 + takeUntil 抬起即停 ============
// 把 29.5「实战案例：拖拽动画」落成可执行代码。正文用 animationFrames() 对齐浏览器
// rAF，Node 没有 rAF，这里把帧时钟注入（frameClock$），指针事件也用流注入，
// 其余操作符编排与正文逐行同构：
//   down$ → switchMap(建立帧循环) → frames$ withLatestFrom pointerX$ → clamp → takeUntil(up$)
// 被验证的硬性质：
// - 输出只发生在帧滴答上，pointermove 再密集也只被「读取」不「触发」（帧率由时钟说了算）;
// - startWith(down.x) 让按下即有一帧输出，不必等第一次移动；
// - pointerup 后帧循环立即停，再次按下由 switchMap 重建（旧循环的监听随之清理）；
// - 坐标钳制在 [0,1]，元素隐藏宽度为 0 时按 1 兜底防 NaN。

import { type Observable } from "rxjs";
import { map, startWith, switchMap, takeUntil, withLatestFrom } from "rxjs/operators";
import { TestScheduler } from "rxjs/testing";

/** 硬断言：console.assert 在 Node 里不阻断，脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

interface PointerStreams {
  down$: Observable<{ x: number }>;
  move$: Observable<{ x: number }>;
  up$: Observable<unknown>;
}

// ---------------- 被测实现：与正文 29.5 同构 ----------------

function trackDragProgress(
  streams: PointerStreams,
  frameClock$: Observable<unknown>,
  trackWidth: number,
): Observable<number> {
  // 正文的 rect.width || 1：隐藏元素宽度为 0，不兜底会得到 NaN，样式写入直接失效
  const width = trackWidth || 1;

  return streams.down$.pipe(
    switchMap((down) => {
      // 正文中 getBoundingClientRect 在 pointerdown 时缓存一次，绝不搬进帧循环
      const pointerX$ = streams.move$.pipe(
        map((m) => m.x),
        startWith(down.x),
      );

      // 以渲染帧为主时钟：每帧取一次最新指针位置，只写一次样式
      return frameClock$.pipe(
        withLatestFrom(pointerX$),
        map(([, x]) => Math.min(Math.max(x / width, 0), 1)),
        takeUntil(streams.up$),
      );
    }),
  );
}

// ---------------- 测试夹具 ----------------

const makeScheduler = () =>
  new TestScheduler((actual, expected) => {
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      `marble 不符\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`,
    );
  });

// ---------------- 场景 A：帧主时钟——移动只被读取，输出只落在帧滴答上 ----------------

makeScheduler().run(({ hot, expectObservable }) => {
  // 帧时钟：f2/f4/f6/f8/f10 各一帧
  const frames$ = hot("--f-f-f-f-f---");
  const down$ = hot("-d--------------", { d: { x: 100 } }); // f1 按下，x=100
  const move$ = hot("---m-n----------", { m: { x: 150 }, n: { x: 50 } }); // f3、f5 各移一次
  const up$ = hot("-------u---------"); // f7 抬起

  const progress$ = trackDragProgress({ down$, move$, up$ }, frames$, 200);

  // f2: startWith(100) → 0.5（按下即有一帧，不等第一次移动）
  // f4: f3 的移动被「读取」→ 150/200 = 0.75；f5 的移动同理在 f6 落地 → 0.25
  // f7 抬起后内层流停：f8/f10 的帧滴答不再产出（move 高频也不触发输出）
  expectObservable(progress$).toBe("--a-b-c------", {
    a: 0.5,
    b: 0.75,
    c: 0.25,
  });
});

console.log("✓ 场景 A：帧主时钟采样，pointermove 只被读取不触发，抬起即停");

// ---------------- 场景 B：抬起再按重启 + 越界钳制 + 除零兜底 ----------------

makeScheduler().run(({ hot, expectObservable }) => {
  const frames$ = hot("--f-f-f-f-f---");
  const down$ = hot("-d---e----------", { d: { x: 100 }, e: { x: 400 } }); // f1 按下；f5 再次按下
  const move$ = hot("-------m--------", { m: { x: -50 } }); // f7 向左拖出轨道
  const up$ = hot("---u-----u------"); // f3 第一次抬起；f9 第二次抬起

  const progress$ = trackDragProgress({ down$, move$, up$ }, frames$, 200);

  // f2: 第一次拖拽 0.5；f3 抬起后 f4 无输出（旧帧循环已停）
  // f5 再次按下由 switchMap 重建帧循环：f6 → 400/200 = 2 钳制为 1
  // f7 拖出左界：f8 → -50/200 = -0.25 钳制为 0；f9 抬起后 f10 的帧滴答不再产出
  expectObservable(progress$).toBe("--a---b-c----", {
    a: 0.5,
    b: 1,
    c: 0,
  });
});

console.log("✓ 场景 B：switchMap 重建帧循环，越界钳制 [0,1]");

// ---------------- 场景 C：轨道宽度为 0（隐藏态）按 1 兜底，不产出 NaN ----------------

makeScheduler().run(({ hot, expectObservable }) => {
  const frames$ = hot("--f-------------");
  const down$ = hot("-d--------------", { d: { x: 100 } });
  const move$ = hot("----------------");
  const up$ = hot("----------------");

  const progress$ = trackDragProgress({ down$, move$, up$ }, frames$, 0);

  // width 0 → 兜底为 1：100/1 = 100 钳制为 1，而不是 NaN
  expectObservable(progress$).toBe("--a-------------", { a: 1 });
});

console.log("✓ 场景 C：隐藏轨道宽度为 0 时兜底防 NaN");
console.log("\n全部断言通过：帧主时钟、抬起即停、重按重建、钳制与除零兜底");
