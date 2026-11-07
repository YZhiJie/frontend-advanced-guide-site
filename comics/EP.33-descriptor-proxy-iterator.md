# EP.33 描述符·Proxy 与现代 ES

> 对应正文：[01-javascript-advanced.md](../01-javascript-advanced.md)（1.9 属性描述符与对象封闭 / 1.12 ES 版本特性演进 / 1.13 Proxy 与 Reflect）· 示例：`examples/01-26-property-descriptors.ts`、`examples/01-29-es2022-2027-features.ts`、`examples/01-30-proxy-reflect.ts`

## 剧情回顾

- **第 1 格**：像素酱遇到三连击——`const CONFIG` 被随手改写、Vue2 里给对象新增键视图不刷新、新 ES API 看花眼。
- **第 2 格**：码叔亮出属性描述符：每个属性都有一张配置表，`get/set` 能拦读写，`preventExtensions/seal/freeze` 三档逐级上锁。
- **第 3 格**：标签君搬出 Proxy：代理整个对象，13 个捕获器全包，新增键、数组下标、`length`、删除都拦得住——Vue3 响应式的地基。
- **第 4 格**：码叔结案 ES2022→ES2027 时间线与三条铁律：freeze 只冻一层、Proxy 转发带 receiver、新 API 先特性检测再降级。

## 知识点拆解

### 第 1 格 · const 为什么锁不住属性

`const` 绑定的是**变量名**（不可重新赋值），不是对象内容。要让对象属性不可变，需要属性描述符层面的 `writable:false` 或 `Object.freeze`。Vue2 的响应式用 `defineProperty` 逐属性改写，但它天然漏掉三类操作：新增键、删除键、数组下标与 `length` 变化，所以才需要 `Vue.set/delete` 打补丁。

### 第 2 格 · 描述符与封闭三档

| API | 禁新增 | 禁删除/重配 | 禁改值 |
| --- | ------ | ----------- | ------ |
| `Object.preventExtensions(o)` | ✅ | ❌ | ❌ |
| `Object.seal(o)` | ✅ | ✅ | ❌ |
| `Object.freeze(o)` | ✅ | ✅ | ✅ |

要点：`defineProperty` 省略的特性默认 `false`；`value/writable` 与 `get/set` 互斥；三档都是**浅**操作，嵌套对象要递归 `deepFreeze`；ESM/严格模式下违规直接抛 `TypeError`。

### 第 3 格 · Proxy 与 Reflect 为什么成对出现

```js
new Proxy(state, {
  get(target, key, receiver) {
    track(target, key);
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    const ok = Reflect.set(target, key, value, receiver);
    trigger(target, key);
    return ok;
  },
});
```

- `Reflect.*` 与 13 个捕获器一一对应，返回值/布尔标记语义完整；
- `receiver` 表示访问时 `this` 的真实指向：代理被继承时，getter 的 `this` 必须是继承者，省略 receiver 会让多态失效；
- Proxy 代理整个对象（含新键与数组），深层对象可在 get 时惰性包代理，性能优于启动时全量改写。

### 第 4 格 · 现代 ES 时间线与特性检测

| 版本 | 代表 |
| ---- | ---- |
| ES2022 | 私有字段 `#x`、`#x in obj`、静态块、`Error.cause` |
| ES2023 | `toSorted/toReversed/toSpliced/with`、`findLast` |
| ES2024 | `Object.groupBy`、`Promise.withResolvers` |
| ES2025 | Iterator helpers、`Promise.try`、Set 数学方法、`RegExp.escape` |
| ES2026 | `Array.fromAsync`、`JSON.rawJSON`、`Math.sumPrecise` |
| ES2027 候选 | `using`/DisposableStack、Temporal、`Iterator.zip` |

统一姿势：`typeof fn === 'function'`（或 `'key' in proto`）探测 → 新 API / 降级分支；语法靠 Babel/SWC 转译，内置 API 靠 polyfill/运行时，两者不是一回事。

## 坑点清单

> 🔗 正文对照：[《1.19 本章避坑清单》](../01-javascript-advanced#_1-19-本章避坑清单)

1. **freeze 只冻一层**：嵌套对象照样可改，配置数据必须递归冻结；冻结前先拷贝，别冻调用方的入参；
2. **Proxy 捕获器手写 `target[key]` 会丢语义**：一律 `Reflect.*` 转发并透传 receiver，否则代理被继承时 getter 的 `this` 指错；
3. **新 API 不检测直接用**：低版本引擎整段崩；`as any` 绕过的是类型检查，运行时该不存在还是不存在；
4. **规范年份 ≠ 引擎可用**：Stage 4 定稿到 V8 落地可能差半年到一年，上线前在最低版本 Node/浏览器实测。

## 自测 3 题（含答案）

1. **`Object.freeze` 一个嵌套配置对象后，修改内层属性会报错吗？**——不会。freeze 是浅锁定，只冻结顶层自身属性，内层对象描述符不变仍可写；必须递归 `deepFreeze` 才彻底。ESM 严格模式下改顶层冻结属性会直接抛 TypeError。
2. **Proxy 的 get 捕获器里为什么要写 `Reflect.get(target, key, receiver)` 而不是 `target[key]`？**——Reflect 转发会原样处理原型链与 receiver：代理被其他对象继承时，访问器 getter 的 `this`（receiver）指向继承者；直接 `target[key]` 会让 getter 读到原型自己的字段，多态失效。
3. **想在项目里用 ES2025 Iterator helpers 和 ES2026 `JSON.rawJSON`，兼容旧 Node 的正确做法是什么？**——先查 TC39 finished-proposals 确认版本与引擎落地情况，运行时用 `typeof Iterator.from === 'function'` 等做特性检测并提供降级（普通循环 / 字符串大整数方案）；构建侧语法用 Babel/SWC 转译，缺失的内置 API 用 core-js 等 polyfill，两条线分开处理。
