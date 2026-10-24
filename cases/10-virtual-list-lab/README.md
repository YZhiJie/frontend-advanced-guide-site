# case 10：手写虚拟列表与帧调度

用纯 TypeScript（零运行时依赖、不依赖 DOM）手写虚拟列表核心算法与帧调度器：定高/变高两种模式的窗口计算、前缀和偏移表与二分定位、overscan 缓冲夹紧，以及把同一帧内多次调度合并为一次执行的注入式 rAF 调度器；所有外部依赖（帧回调等）均可注入，测试完全离线确定。

与 `examples/` 中的单文件片段相比，这里是一个带 `package.json`、`tsconfig.json`、`src/`、`test/` 的可运行小工程，可以直接 `npm test` 跑回归。

## 目录结构

```
10-virtual-list-lab/
├── package.json
├── tsconfig.json
├── src/
│   ├── virtual-list.ts      # 定高/变高窗口计算 + 前缀和偏移 + 二分定位
│   └── scheduler.ts         # 注入式 rAF 帧调度器（同帧合并/去重保序/flush/cancel）
├── test/
│   └── virtual-list.test.ts # node:test 回归用例（19 个）
└── README.md
```

## 运行

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # tsx --test test/*.test.ts（19 个用例）
```

## 关键设计

- **定高模式**：`itemHeight` 已知且全项等高时，前缀和偏移表退化为等差数列，窗口只用除法即可定位；首项位移 `offsetY = startIndex * itemHeight`，无需逐项测量。
- **变高模式**：以 `itemHeight` 作为未测项的预估值（`estimatedItemHeight`），`measure(index, height)` 写入已测高度数组并按前缀和重建偏移表；预估与实测的差额在 `getTotalHeight()` 中自动校正。
- **二分定位**：把前缀和偏移表视为有序序列，用「`offsets[i] <= scrollTop` 的最大下标」与「`offsets[i] >= 底沿` 的最小下标」两次上下界二分求窗口，使每帧定位从 O(n) 降到 O(log n)。
- **overscan 夹紧**：可视窗口上下各多留 `overscan` 项作缓冲；`startIndex` 不低于 0、`endIndex` 不高于 `itemCount - 1`，既避免滚动时白屏闪烁，又不会渲染到列表之外。
- **边界鲁棒**：空列表返回 `{ startIndex: 0, endIndex: -1 }` 且可视项为空；滚动位置夹紧到 `[0, totalHeight - viewportHeight]`；越界 `measure` 与非法高度直接忽略。
- **帧合并调度**：`createFrameScheduler(raf)` 注入 rAF，同一帧内 `schedule` 的同一函数借 `Set` 去重、按首次登记顺序保序，整帧只注册一次帧回调；`flush` 手动立即执行并用「代际令牌」作废旧帧，`cancel` 丢弃待办。

## 对应章节

- [10.3 渲染性能优化实战](../10-browser-rendering.md#_10-3-渲染性能优化实战)
- [10.4 高性能虚拟列表](../10-browser-rendering.md#_10-4-高性能虚拟列表)
