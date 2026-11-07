# case 09：手写迷你测试框架

纯 TypeScript、零运行时依赖地手写一个迷你测试框架，把「断言库 + 运行器 + mock」的原理讲透：用 describe/it 收集用例与钩子，用 expect 断言、mockFn 打桩，最后由 run() 统一执行并汇总结果。

## 目录结构

```
09-mini-test-lab/
├── package.json
├── tsconfig.json
├── src/
│   └── mini-test.ts        # createRunner + expect + mockFn + deepEqual
├── test/
│   └── mini-test.test.ts   # node:test 元测试（17 个）
└── README.md
```

## 运行

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # tsx --test test/*.test.ts（17 个用例，元测试框架自身行为）
```

## 关键设计

- **收集与执行分离**：`describe`/`it` 只负责登记用例与钩子，`run()` 才按注册顺序统一执行。这样 `it` 能返回一个在 `run()` 之后才解析的 `Promise<TestResult>`，异步用例天然被 `await`。
- **断言只抛信号、运行器负责兜底**：`expect` 失败抛 `AssertionError`，`run()` 逐用例 `try/catch`，错误记入 `results[].error` 而非冒泡中断进程，因此一个失败用例不会影响后续用例。
- **深比较而非序列化比较**：`toEqual` 递归比较数组与普通对象，primitive 一律交给 `Object.is`，所以 `NaN` 判定相等、`+0`/`-0` 判定不等。
- **`not` 用 getter 实现**：`expect(actual)` 返回一个 `not` getter，指向同一套 matcher 的「取反版」实例，取反逻辑只写一份。
- **钩子沿套件链继承**：每个套件节点持有自己的四个钩子数组，用例登记时记录从根到叶的套件链；运行时 `beforeAll` 每套件仅一次（根 → 叶），`beforeEach` 由外向内，`afterEach` 由内向外且包围每个用例。
- **only 抢占 skip**：只要存在任一 `it.only`，非 only 用例一律记为 `skipped`，与主流框架语义一致。
- **mock 记录与实现分离**：`calls` 保存实参、`callCount` 由 `calls.length` 派生，`mockReturnValue`/`mockImplementation` 覆盖当前实现，`mockClear` 只清记录不清实现。
- **可测性优先**：框架状态全部封在 `createRunner()` 的闭包中，配合 `reset()`，元测试之间互不污染；模块级 API 只是默认运行器的一层便捷绑定。

## 对应章节

- [9.1 测试金字塔与整体策略](../09-testing.md#_9-1-测试金字塔与整体策略)
- [9.2 单元测试与 Vitest](../09-testing.md#_9-2-单元测试与-vitest)
