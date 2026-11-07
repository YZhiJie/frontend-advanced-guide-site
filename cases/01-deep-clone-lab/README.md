# case 01：生产级 deepClone 实验室

手写一个覆盖常见坑位的 `deepClone`，把「基本类型、Date/RegExp/Map/Set、数组与纯对象、循环引用、Symbol 键、原型链保留、函数与不可克隆对象原样返回」逐一落地，并用真实测试锁住行为。

与 `examples/01-21-deep-clone.ts`（单文件片段）的区别：这里是一个带 `package.json`、`tsconfig.json`、`src/`、`test/` 的可运行小工程，可以直接 `npm test` 跑回归。

## 目录结构

```
01-deep-clone-lab/
├── package.json
├── tsconfig.json
├── src/
│   └── deep-clone.ts        # 导出 deepClone<T>(value: T): T
├── test/
│   └── deep-clone.test.ts   # node:test 回归用例
└── README.md
```

## 运行

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # tsx --test test/*.test.ts
```

## 关键设计

- **WeakMap 记录已克隆对象**：既斩断循环引用，又因弱引用不阻止对象被 GC 回收。
- **先登记缓存再遍历**：`Map` / `Set` / 数组等在递归前就把结果写入 `seen`，保证内部循环也能命中缓存。
- **原型链保留**：普通对象与类实例用 `Object.create(Object.getPrototypeOf(obj))` 创建，原型上的方法得以保留。
- **Symbol 键**：用 `Reflect.ownKeys` 而非 `Object.keys`，同时覆盖字符串键与 Symbol 键。
- **原样返回**：函数、`WeakMap` / `WeakSet` / `Promise` 这类内部状态不可枚举的对象直接返回。

## 对应章节

- [1.8 手写高频工具函数](../01-javascript-advanced.md#_1-8-手写高频工具函数)
- [1.11 Symbol 与集合类型](../01-javascript-advanced.md#_1-11-symbol-与集合类型)
