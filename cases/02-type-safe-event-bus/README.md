# case 02：类型安全的事件总线

用泛型 + 条件类型 + `infer` 约束一个事件总线的 API：事件名限定在 `keyof Events`，handler 参数由 `Events[K]` 推导，`emit` 的参数列表由条件类型决定（无参事件可省略实参）。

与 `examples/01-22-event-bus.ts`（单文件片段）的区别：这里带完整 `src/` / `test/` 与构建链，运行时行为与编译期类型约束一起验证。

## 目录结构

```
02-type-safe-event-bus/
├── package.json
├── tsconfig.json
├── src/
│   └── event-bus.ts        # createEventBus<Events>() -> { on, off, once, emit }
├── test/
│   └── event-bus.test.ts   # 运行时行为 + 编译期类型校验
└── README.md
```

## 运行

```bash
npm install
npm run typecheck   # tsc --noEmit（校验编译期类型约束）
npm test            # tsx --test test/*.test.ts
```

## 关键设计

- **泛型约束事件名**：`on<K extends keyof E>(type: K, ...)`，传入不存在的事件名直接报错。
- **payload 类型推导**：`EventHandler<E, K> = (payload: E[K]) => void`，回调参数无需手动标注。
- **条件类型决定 emit 参数**：`EmitArgs<P> = [P] extends [void] ? [] : [payload: P]`，无参事件 `emit('ready')` 合法，`emit('ready', 1)` 报错。
- **infer 演示**：`PayloadOf<H>` 从 handler 类型反推 payload 类型。
- **编译期断言**：测试文件用 `@ts-expect-error` 把约束交给 `tsc` 校验，运行时不会执行这些分支。

## 对应章节

- [2.2 泛型深入](../02-typescript.md#_2-2-泛型深入)
- [2.3 条件类型与 infer](../02-typescript.md#_2-3-条件类型与-infer)
