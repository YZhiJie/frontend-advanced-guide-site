# case 11：手写有限状态机

用纯 TypeScript 手写一个零依赖、类型安全的有限状态机：以「转移表」声明状态与事件，支持守卫、进入/离开钩子与动作、订阅状态转移，并让非法事件名在编译期就被拒绝，把设计模式里的「状态模式」讲透。

## 目录结构

```
11-state-machine-lab/
├── package.json
├── tsconfig.json
├── src/
│   └── machine.ts        # createMachine + 转移表 + 守卫/动作/钩子
├── test/
│   └── machine.test.ts   # node:test 回归用例（14 个）
└── README.md
```

## 运行

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # tsx --test test/*.test.ts（14 个用例）
```

## 关键设计

- **转移表为中心**：状态与转移全部以数据（`transitions[from][event] = { target, ... }`）声明，`send` 只做一次查表，逻辑集中、易于穷举与校验；新增状态/事件不改引擎代码。
- **编译期约束非法事件**：状态名 `S`、事件名 `E` 都提升为字符串泛型，转移表用映射类型约束键，`send`/`can` 只接受 `E`，因此传入非法事件名直接编译不过，运行时的兜底只用于「当前态无该事件」。
- **守卫 gate**：转移可带 `guard(ctx, payload)`，返回 `false` 则本次转移被拦截——不换状态、不跑动作、不通知订阅者，`send` 返回 `false`；`can` 预判同样评估守卫，故守卫应保持纯函数。
- **动作时序**：转移成功严格按 `exit`（旧态钩子）→ `action`（携带 context 与 payload，可更新 context）→ `enter`（新态钩子）执行，`enter` 触发时状态已是新态，顺序可被轨迹断言。
- **兜底策略**：当前状态没有对应转移时，`onInvalid` 决定静默忽略（默认 `"ignore"`，`send` 返回 `false`）还是抛错（`"throw"`）；无论哪种都不会改变状态。
- **可订阅且保序**：`subscribe` 收到 `{ from, to, event, payload }`，订阅者存于 `Set` 天然保序、通知前先快照再遍历；返回的取消函数即 `Set.delete`，被拒绝的转移不产生任何通知。
- **context 可变更新**：`context` 以单一引用贯穿机器生命周期，动作/钩子直接改写它即可（受控 mutation），`getContext()` 返回同一引用，避免每步转移都重建对象；若需不可变语义，可在动作里替换字段值或按需改造。
- **创建即校验**：创建时校验 `initial` 与所有转移 `target` 都落在 `states` 内，配置写错立即抛错，让 `states` 声明真正生效。

## 对应章节

- [11.1 前端常用设计模式](../11-patterns-architecture.md#_11-1-前端常用设计模式)
