# case 03：最小 monorepo 工具链

不引任何第三方构建工具，只用 Node 原生能力（`node:fs`、`node:child_process`）演示 workspace 依赖编排：读根 `package.json` 的 `workspaces` 与各子包 `package.json`，构建包依赖图，做拓扑排序（含环检测），再按拓扑序执行各子包 script。

## 目录结构

```
03-monorepo-toolkit/
├── package.json
├── tsconfig.json
├── src/
│   ├── topo.ts        # buildGraph + topologicalSort（环检测）
│   └── run-tasks.ts   # 按拓扑序执行 script，执行器可注入
├── test/
│   └── topo.test.ts   # 临时工作区里验证图构建 / 排序 / 环检测
└── README.md
```

## 运行

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # tsx --test test/*.test.ts
```

## 关键设计

- **workspace 展开**：支持 `workspaces: ["packages/*"]` 数组写法与 `{ packages: [...] }` 对象写法，`packages/*` 会展开为真实子目录。
- **依赖图裁剪**：只把「属于工作区」的依赖计入图，`react` 这类外部依赖被忽略。
- **Kahn 拓扑排序**：从入度 0 出发，输出顺序按字典序稳定；排不完即说明有环。
- **环检测**：抛错并列出卡在环里的包，便于 CI 直接失败。
- **可注入执行器**：`runTasks` 默认派生 `npm run <script>`，测试注入替身即可断言执行顺序与跳过逻辑。

## 对应章节

- [3.6 Monorepo 实践](../03-engineering.md#_3-6-monorepo-实践)
- [3.7 CI/CD 与质量工具链](../03-engineering.md#_3-7-ci-cd-与质量工具链)
