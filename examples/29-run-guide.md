# 第二十九册 RxJS 实战案例运行指南（29-01 ~ 29-04）

> 配套正文：[29-rxjs.md](../29-rxjs.md)｜自测题答案册：[29-00-quiz-answers.md](./29-00-quiz-answers.md)
> 四个示例全部跑在 TestScheduler 虚拟时钟上：**不等真实时间、帧帧可复现、断言写错即红**。

## 1. 环境准备

- Node ≥ 18（建议 22+；仓库门禁基线为 Node 24，RxJS 7.8.2）
- 首次运行前安装依赖（tsx + rxjs 都装在 examples 目录内）：

```bash
cd examples && npm install
```

## 2. 三种运行方式

```bash
# 方式一：仓库根目录（与正文「> 运行方式」一致，门禁 check-examples 实跑的也是这条）
npx tsx examples/29-01-auto-save.ts

# 方式二：examples 目录内（省掉路径前缀）
cd examples && npx tsx 29-01-auto-save.ts

# 方式三：CLI 前缀匹配（首次自动下载 CLI 包）
npx frontend-advanced-guide-examples run 29-01
```

离线/加速提示：tsx 已安装在 `examples/node_modules/.bin`，直接调用可避免 npx 每次走 registry：

```bash
cd examples && ./node_modules/.bin/tsx 29-01-auto-save.ts
```

## 3. 输出与退出码约定

- 全部通过：逐场景打印 `✓ …`，末尾一行「全部断言通过：…」，退出码 0。
- 任一失败：打印 `✗ 断言失败：…`（marble 断言附带期望/实际 JSON diff，`frame` 字段直接指出错位帧），随后 `process.exit(1)`——CI 与门禁靠退出码判红，不靠肉眼。

---

## 4. 案例逐个说

### 29-01 草稿自动保存（对应正文 29.5 实战案例一）

```bash
npx tsx examples/29-01-auto-save.ts
```

预期输出：

```
✓ 场景 A：连续输入防抖，只保存最后一次（saving → saved）
✓ 场景 B：失败降级为 'failed' 状态，后续输入照常保存
✓ 场景 C：destroy 同时断开下游并拒收上游，卸载后输入不再触发保存

全部断言通过：防抖只存最新、失败不死、卸载收口
```

| 场景 | 操作符编排 | 帧时间线（1 字符 = 1 帧） | 证明的性质 |
| --- | --- | --- | --- |
| A | `debounceTime(3)` + `switchMap` | f1 输入 A、f3 输入 B → f6 才触发 saving，f8 saved | A 的静默期被 B 打断，`saveDraft` 全程只被调用 1 次且拿到的是 B |
| B | 失败在内层转成 `'failed'` 值 | f4 saving → f5 failed；f8 saving → f9 saved | 失败没有以 error 冒出 `switchMap`，整条流不终结 |
| C | `takeUntil(destroy$)` + `input$.complete()` | f4 saving、f5 saved、f6 destroy → 流完成；f9 的输入被吞 | 下游断开 + 上游拒收，两者缺一不可 |

动手实验：

- 把 `createAutoSave(saveDraft, 3)` 的 `3` 改成 `2`，场景 A 的 marble 立即错位——体会「防抖窗口 = 业务口径」必须写进断言。
- 把场景 B 的 `cold("-r|")` 换成 `cold("-#")`（保存以 error 终结），观察 `----sf--sv-` 的后半段消失——正文踩坑点「流死在保存中」的实证。
- 删掉场景 C 的 `destroyAt$.subscribe(...)`，看 destroy 缺失时断言怎么红。

### 29-02 WebSocket 心跳与自动重连（对应正文 29.5 实战案例二）

```bash
npx tsx examples/29-02-ws-reconnect.ts
```

预期输出：

```
✓ 退避公式：指数增长且 15s 封顶，timer 不会拿到非法延迟
✓ 断线重连：error 终结后按退避重建，消息时间线精确到帧
✓ 心跳停表：断线与卸载两条路径，ping 计数立即冻结
✓ share 多播：两个订阅者共享连接，每代只建连一次

全部断言通过：defer + retry + takeUntil + share 的重连编排成立
```

剧本与断言的对应关系：

- 退避公式（纯函数先行）：`Math.min(2 ** attempt * 500, 15000)` → 1/2/3/4 次为 1s/2s/4s/8s，第 5 次起封顶 15s——正文强调「不封顶 timer 会被天文数字撑爆」。
- 连接剧本：第一代 `cold("--t-------#")`（f2 推一条行情、f10 以 **error** 断线——`webSocket` 断开是 error 而非 complete）；测试尺度退避 5 帧 → f15 重建；第二代 f17 推行情、f20 推公告；f23 页面卸载。
- 消息时间线断言：tick 恰在 `[f2, f17]`，notice 恰在 f20——重连不是「立刻」，是「退避之后」。
- 心跳停表断言：`interval(3)` 第一代 ping@f3/f6/f9 共 3 次，断线后 `finalize` 停表；第二代 f15 重建后 ping@f18/f21 共 2 次，卸载后不再增长。
- share 断言：`ticks$`/`notices$` 两个订阅者同时在订阅，但建连计数恰好 2（每代 1 条）——若把 `share()` 挪到 `retry` 之前，计数会翻倍变 4，断言直接红。

动手实验：把 `share()` 移到 `retry` 前面，或删掉 `finalize(() => heartbeat.unsubscribe())`，分别观察「连接数暴涨」与「ping 计数不停」两类事故如何被断言捕获。

### 29-03 批量聚合上传（对应正文 29.5 实战案例三）

```bash
npx tsx examples/29-03-batch-upload.ts
```

预期输出：

```
✓ 场景 A：超时/攒满双阈值生效，空窗口零请求
✓ 场景 B：并发上限 2 在洪峰下严格成立，批次排队让位
✓ 场景 C：失败批重试 2 次后单独丢弃，上传流不终结

全部断言通过：双阈值攒批、空窗过滤、并发上限、整批重试降级
```

| 场景 | 关键断言 | 说明 |
| --- | --- | --- |
| A | 上传批次为 f4 `[a,b]`、f7 `[c,d,e]`、f11 `[f]`，且无空批 | `bufferTime(4, null, 3)`：超时与攒满 3 条都会 flush；`null` 第二参是 `restartOnEmit`——**提前 flush 后窗口从当帧重新计时**，所以 `[f]` 落在 f11 而不是 f12 |
| B | 4 批全部落定、在飞峰值 = 2、落定帧恰为 6,8,10,12 | 每 2 帧攒 1 批、上传耗时 5 帧形成积压；`mergeMap` 第三参并发上限让后批等前批让位 |
| C | 失败批尝试恰为 f4/f6/f8 三次（1+2 重试），f8 丢弃；正常批 g1/g2 不受影响 | `retry({ count: 2, delay })` + `catchError` 兜底成 `of(null)`，单批事故不拖垮整条上传流 |

动手实验：把场景 B 的 `concurrent: 2` 改成 `4`，「在飞峰值应被压在 2」立刻红——并发上限是被断言守住的，不是靠自觉。

### 29-04 拖拽动画（对应正文 29.5 实战案例四）

```bash
npx tsx examples/29-04-drag-frames.ts
```

预期输出：

```
✓ 场景 A：帧主时钟采样，pointermove 只被读取不触发，抬起即停
✓ 场景 B：switchMap 重建帧循环，越界钳制 [0,1]
✓ 场景 C：隐藏轨道宽度为 0 时兜底防 NaN

全部断言通过：帧主时钟、抬起即停、重按重建、钳制与除零兜底
```

- 场景 A：帧滴答在 f2/f4/f6/f8/f10，移动在 f3/f5——输出只落在 f2/f4/f6（`--a-b-c------`），f7 抬起后 f8/f10 静默。证明 `withLatestFrom` 的方向：帧时钟是主、指针位置是被采样的副；若误用 `combineLatest`，输出频率会被 move 拉高，marble 立刻不符。
- 场景 B：f3 抬起 → f4 无输出（旧帧循环已停）；f5 再次按下由 `switchMap` 重建 → f6 输出 `400/200=2` 钳制为 1；f8 输出 `-50/200=-0.25` 钳制为 0；f9 抬起后 f10 静默。
- 场景 C：`trackWidth` 传 0，内部 `|| 1` 兜底——输出 1 而不是 NaN（正文踩坑点：隐藏元素 `rect.width` 为 0）。

---

## 5. marble 与 TestScheduler 排坑速查

| 坑 | 现象 | 对策 |
| --- | --- | --- |
| 分组括号占帧 | `(ab)` 的 `(` 与 `)` 在 RxJS 7.8 中**各占 1 帧**，`-(ab)-(cd)-` 的两组实际间隔 5 帧而非 3 帧 | 精确帧断言用逐帧单字符（如 29-03 场景 B 的 `-abcdefgh|`），分组只用于表达「同帧多值」语义 |
| 调度器实例复用 | 同一 `TestScheduler` 跨 `run` 虚拟时钟**不归零**，第二场景帧整体偏移 | 每个场景新建实例（29-01 的 `makeScheduler()`） |
| `bufferTime` 无限开窗 | 源流不 complete 时窗口周期重建，`flush()` 永不返回（脚本挂死） | 被测工厂暴露 `close()` 收口，测试里 `complete` 输入时一并调用（29-03） |
| 常驻 Subject 不完成 | 状态流不会因「输入流完成」而完成，marble 里写 `|` 必红 | 只有 `destroy`/`takeUntil` 才让它完成（29-01 场景 A/B 的期望均无 `|`） |
| 边界同帧归属 | 事件与关窗同帧时落进「正在关闭」的窗口（调度先入先出） | 设计帧时间线时刻意避开或显式注释（29-03 场景 B 边界注释） |
| 失败 diff 不会读 | `✗ 断言失败：marble 不符` 附期望/实际 JSON | 对比 `frame` 字段：偏移 = 时间线设计错；缺条 = 流提前死/没收口 |

## 6. 与正文、答案册的对照

| 示例 | 正文章节 | 关联自测题 | 验证方式 |
| --- | --- | --- | --- |
| 29-01 | 29.5 实战案例：草稿自动保存 | 第 14、19 题 | 3 场景 marble 断言 |
| 29-02 | 29.5 实战案例：WebSocket 心跳与自动重连 | 第 15、18 题 | 逐帧记录 + 计数断言 |
| 29-03 | 29.5 实战案例：批量聚合上传 | 第 8、20 题 | 3 场景帧记录断言 |
| 29-04 | 29.5 实战案例：拖拽动画 | 第 3、13 题 | 3 场景 marble 断言 |

> 这批示例同时是仓库门禁 `node scripts/check-examples.mjs` 的实跑对象：正文「> 运行方式」行声明的命令会被逐条实跑，改坏任何一条都会卡 CI。
