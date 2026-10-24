# EP.03 工程化与摇树优化

> 对应正文：[03-engineering.md](../03-engineering.md)（模块化 / Tree Shaking / 性能指标）· 示例：`examples/03-01-modules/esm/main.ts`、`examples/03-02-tree-shaking.ts`、`examples/03-03-web-vitals.ts`

## 剧情回顾

- **第 1 格**：标签君只用了一个 `cloneDeep`，全量 `import _ from 'lodash'` 却把整库拖进产物。
- **第 2 格**：码叔揭秘摇树：ESM 静态声明让打包器沿依赖图删除未引用导出，CJS 做不到。
- **第 3 格**：像素酱实证 `sideEffects` 副作用白名单与动态 `import()` 路由分包。
- **第 4 格**：码叔结案——优化用 Web Vitals 指标说话，警惕 barrel 文件毁掉摇树。

## 知识点拆解

### 第 1 格 · 全量导入的代价

- `import _ from 'lodash'` 把整个库打进 bundle，gzip 后依然几百 KB；
- 首屏 JS 体积直接影响下载、解析、执行三段时间，用户感知就是"白屏久"；
- 用 `webpack-bundle-analyzer` / `rollup-plugin-visualizer` 先看清产物构成。

### 第 2 格 · 摇树为什么依赖 ESM

- ESM 的 `import` / `export` 是**静态声明**，编译期即可构建完整依赖图；
- 打包器从入口标记所有被引用的导出，未标记的即"死代码"，压缩阶段删除；
- CommonJS 的 `require` 是运行时行为，路径与导出动态可变，摇树基本失效。

### 第 3 格 · sideEffects 与分包

```json
{ "sideEffects": ["**/*.css", "./src/polyfills.ts"] }
```

- 副作用白名单告诉打包器：白名单外的文件"删掉未被引用的导出是安全的"；
- 动态 `import()` 把代码切成独立 chunk，路由级按需加载，首屏只留公共部分；
- 二者配合：摇树管"删得干净"，分包管"加载得晚"。

### 第 4 格 · 用 Web Vitals 说话

- **LCP < 2.5s**（最大内容绘制）、**INP < 200ms**（交互延迟）、**CLS < 0.1**（累积布局偏移）；
- 优化闭环：测量 → 改造 → 回归对比，避免"感觉变快了"式的自我安慰。

## 坑点清单

> 🔗 正文对照：[《3.9 本章避坑清单》](../03-engineering#_3-9-本章避坑清单)

1. barrel 文件（`index.ts` 全量 `export *`）会让打包器无法确定引用关系，摇树失效；
2. 依赖库选 CommonJS 版本（如 `lodash` 而非 `lodash-es`），摇不动；
3. 给含副作用的模块错误标记 `sideEffects: false`，导致生产代码被误删。

## 自测 3 题（含答案）

1. 摇树为什么依赖 ESM？——**ESM 的 import/export 是静态声明，编译期可确定引用关系，未引用导出才能被安全删除**。
2. `sideEffects` 字段的作用？——**声明哪些文件有副作用；白名单外的未引用导出允许被打包器删除**。
3. Web Vitals 三大指标的达标线？——**LCP < 2.5s、INP < 200ms、CLS < 0.1**。
