// 文件: examples/29-01-auto-save.ts
// ============ 草稿自动保存：防抖触发 + 只存最新 + 失败不死 + 统一收口 ============
// 把 29.5「实战案例：草稿自动保存」落成可执行代码：
// debounceTime 静默期触发、switchMap 只保留最新草稿、失败转换成 'failed' 状态值
// （而不是让 error 终结整条流）、destroy 用 takeUntil + complete 双向收口。
// 与正文的差异仅两处：
// - saveDraft 返回 Observable 而非 Promise，便于 TestScheduler 虚拟时间断言
//   （Promise 版只需 from(promise) 包一层，操作符语义完全一致）；
// - 'saving' 用 concat(of(...), ...) 合入状态流，等价于正文的 tap 侧效，
//   但状态收敛成一条时间线，可以被 marble 一次性断言。
// 全部断言跑在 TestScheduler 虚拟时钟上：不等真实 800ms，帧帧可复现。

import { concat, of, Subject, type Observable } from "rxjs";
import { debounceTime, switchMap, takeUntil } from "rxjs/operators";
import { TestScheduler } from "rxjs/testing";

/** 硬断言：console.assert 在 Node 里不阻断，脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

type SaveStatus = "saving" | "saved" | "failed";

interface AutoSave {
  /** 状态流：saving → saved/failed，随 destroy 完成 */
  statuses$: Observable<SaveStatus>;
  /** 用户每敲一次键盘推一份草稿进来 */
  push(draft: string): void;
  /** 组件卸载：先断开整条管道，再让上游拒收新输入，缺一不可 */
  destroy(): void;
}

/**
 * 与正文 29.5 相同的骨架：debounceTime → switchMap → 状态值。
 * 关键点：saveDraft 的失败必须在「内层流里」转成 'failed' 值返回；
 * 若让 error 冒出 switchMap，整条外层流终结——之后怎么输入都不会再保存。
 */
function createAutoSave(
  saveDraft: (draft: string) => Observable<"saved" | "failed">,
  debounceMs = 800,
): AutoSave {
  const input$ = new Subject<string>();
  const destroy$ = new Subject<void>();

  const statuses$ = input$.pipe(
    takeUntil(destroy$),
    debounceTime(debounceMs),
    switchMap((draft) => concat(of("saving" as const), saveDraft(draft))),
  );

  return {
    statuses$,
    push: (draft) => input$.next(draft),
    destroy: () => {
      destroy$.next();
      destroy$.complete();
      input$.complete();
    },
  };
}

// ---------------- 测试夹具：每个场景独立 TestScheduler ----------------
// 同一个实例的虚拟时钟跨 run 不归零，复用会让第二场景的帧整体偏移

const makeScheduler = () =>
  new TestScheduler((actual, expected) => {
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      `marble 不符\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`,
    );
  });

// ---------------- 场景 A：连续输入只保存最后一次，状态序列 saving → saved ----------------

makeScheduler().run(({ cold, hot, expectObservable, flush }) => {
  const calls: string[] = [];
  const saveDraft = (draft: string): Observable<"saved"> => {
    calls.push(draft);
    return cold("--r|", { r: "saved" as const }); // 保存耗时 2 帧
  };

  const autoSave = createAutoSave(saveDraft, 3);

  // f1 输入 A，f3 输入 B：A 的静默期被 B 打断，只有 B 在 f6 触发保存
  const input$ = hot("-a-b-----|", { a: "草稿A", b: "草稿B" });
  input$.subscribe((draft) => autoSave.push(draft));

  // f6 防抖触发 → saving；f8 保存完成 → saved
  // 注意：状态流不会随输入流完成——输入侧是常驻 Subject，只有 destroy 才让它完成
  expectObservable(autoSave.statuses$).toBe("------s-r-", {
    s: "saving",
    r: "saved",
  });
  flush();
  assert(calls.length === 1, `应只保存 1 次，实际 ${calls.length} 次`);
  assert(calls[0] === "草稿B", `应只保存最新的 B，实际保存了 ${calls[0]}`);
});

console.log("✓ 场景 A：连续输入防抖，只保存最后一次（saving → saved）");

// ---------------- 场景 B：失败转成 'failed' 状态值，流不终结 ----------------

makeScheduler().run(({ cold, hot, expectObservable, flush }) => {
  // 模拟正文里 .then(() => 'saved', () => 'failed') 的转换结果：
  // '坏草稿' 存不进去，但以「值」的形式带回来，而不是 error
  const saveDraft = (draft: string): Observable<"saved" | "failed"> =>
    cold("-r|", { r: draft === "坏草稿" ? ("failed" as const) : ("saved" as const) });

  const autoSave = createAutoSave(saveDraft, 3);

  // f1 坏草稿（f4 触发、f5 failed），f5 好草稿（f8 触发、f9 saved）
  const input$ = hot("-a---b---|", { a: "坏草稿", b: "好草稿" });
  input$.subscribe((draft) => autoSave.push(draft));

  // 若失败以 error 冒出，f5 之后整条流就死了，f8/f9 的 saving/saved 不会出现
  expectObservable(autoSave.statuses$).toBe("----sf--sv-", {
    s: "saving",
    f: "failed",
    v: "saved",
  });
});

console.log("✓ 场景 B：失败降级为 'failed' 状态，后续输入照常保存");

// ---------------- 场景 C：destroy 收口——状态流完成，之后再 push 一律无效 ----------------

makeScheduler().run(({ cold, hot, expectObservable, flush }) => {
  const calls: string[] = [];
  const saveDraft = (draft: string): Observable<"saved"> => {
    calls.push(draft);
    return cold("-r|", { r: "saved" as const });
  };

  const autoSave = createAutoSave(saveDraft, 3);

  const input$ = hot("-a-------b---", { a: "卸载前", b: "卸载后" });
  input$.subscribe((draft) => autoSave.push(draft));

  // f6 组件卸载：destroy() 让 statuses$ 完成；f9 的「卸载后」不会再进入管道
  const destroyAt$ = hot("------d--------");
  destroyAt$.subscribe(() => autoSave.destroy());

  // f1 输入 → f4 触发 saving → f5 saved → f6 takeUntil 完成整条流
  expectObservable(autoSave.statuses$).toBe("----sv|", {
    s: "saving",
    v: "saved",
  });
  flush();
  assert(calls.length === 1, `destroy 后不应再有保存，实际调用 ${calls.length} 次`);
  assert(calls[0] === "卸载前", "destroy 前的保存应正常落库");
});

console.log("✓ 场景 C：destroy 同时断开下游并拒收上游，卸载后输入不再触发保存");
console.log("\n全部断言通过：防抖只存最新、失败不死、卸载收口");
