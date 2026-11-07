# EP.51 数据变换瑞士军刀

> 对应正文：[第三十部分 · Lodash 工具库实战](../30-lodash.md)

## 剧情回顾

- **第 1 格**：标签君困惑——项目里引了 `import { debounce, cloneDeep, groupBy, memoize } from 'lodash'`，bundle 体积蹭蹭涨了 100KB+。听说现在原生 API 也有了 `Object.groupBy`、`structuredClone`、`requestAnimationFrame`+自己写 debounce……到底该用 Lodash 还是原生？
- **第 2 格**：码叔点破——Lodash 不是全能瑞士军刀，是"原生没做好的部分"的补丁。它真正价值在三个地方：**稳定的深拷贝循环引用**、**跨浏览器一致的 debounce/throttle cancel/flush 语义**、**链式组合的 `flow`/`pipe`**。原生 `Object.groupBy` 只在现代浏览器才有且返回的是字典不是数组。
- **第 3 格**：像素酱实测——`import { debounce } from 'lodash-es'` + `build.rollupOptions.output.manualChunks` 或 Vite/Rollup 默认 tree-shaking，打包后其实只引入了 debounce 约 2KB。但直接 `import _ from 'lodash'` 就是整个库 100KB+。关键是引入姿势对不对。原生 `structuredClone` 不支持函数/Symbol/DOM——碰到这些 Lodash `cloneDeep` 还是更稳。
- **第 4 格**：码叔结案——三个高频坑：`memoize` 默认不自动清理缓存（函数参数当 key 可能爆内存）、`debounce`/`throttle` 忘记 cancel 导致组件销毁后还在调回调、`groupBy` 返回字典不是数组要再 `Object.values()` 一步。

## 知识点拆解

### 第 1 格 · Tree-shaking 姿势决定体积

```ts
// ✅ 推荐：lodash-es 具名导入，摇树只留用到的
import { debounce, groupBy } from "lodash-es";

// ❌ 禁止：默认导入整个库
import _ from "lodash";

// ❌ 老写法：手动路径导入
import debounce from "lodash/debounce";
```

打包后差距：**100KB+ vs 几 KB**。

### 第 2 格 · 原生 vs Lodash 判定清单

| 能力 | 原生现状 | Lodash 价值 |
| --- | --- | --- |
| 深拷贝 | `structuredClone`（不支持函数/Symbol/DOM/原型） | `cloneDeep` 兜底 |
| groupBy | `Object.groupBy`（Chrome 117+/Safari 17.4+） | `groupBy` 跨浏览器一致 |
| debounce/throttle | 自己写要处理 cancel/flush/maxWait 语义 | 现成且稳定 |
| 节流 | `rAF`/`setTimeout` 自己拼 | 同上 |
| 柯里化 | 无原生 | `curry`/`partial` |

### 第 3 格 · 高频场景：搜索 debounce + 组件销毁

```ts
const debouncedSearch = debounce(
  (kw: string) => api.search(kw).then(renderResults),
  300,
  { leading: false, trailing: true }
);

// 组件挂载后订阅
input.addEventListener("input", (e) => {
  debouncedSearch(e.target.value);
});

// ⚠️ 组件销毁时务必 cancel！
onUnmounted(() => {
  input.removeEventListener("input", debouncedSearch);
  debouncedSearch.cancel(); // 清掉还在等定时器队列里的最后一个调用
});
```

### 第 4 格 · 三个最坑

1. **memoize 缓存泄漏**：默认 `memoize` 永久缓存。参数是对象引用 → 不同引用每次都是新 key → 爆内存。修复：`memoize(fn, resolver)` 用稳定字符串当 key，或 `memoize.Cache = WeakMap`。
2. **debounce 忘记 cancel**：组件 unmount 了，但 setTimeout 队列里还挂着一个 300ms 后的搜索回调，回来就调一个已销毁组件的 setState。
3. **groupBy 返回的是字典不是数组**：`const grouped = _.groupBy(items, 'type')` 后直接 `.map`？报错！要 `Object.values(grouped)`。

## 坑点清单

> 🔗 正文对照：[《30.7 本章避坑清单》](../30-lodash#_30-7-本章避坑清单)

1. **memoize 默认永久缓存 + 对象引用当 key = 内存泄漏**：`memoize` 的 key 是参数的 `toString()` 或引用标识，如果参数里有对象，每次传入不同引用都会被当成新 key。必须配合自定义 resolver 或改用 `memoize.Cache = WeakMap`。
2. **debounce/throttle 忘记 cancel**：组件销毁时挂起的定时器回调会继续执行——轻则 set 到已销毁组件报错，重则数据错乱。规则：debounce/throttle 出来的函数必须暴露 cancel，组件卸载时调。
3. **groupBy 返回字典不是数组**：`_.groupBy(arr, 'type')` 返回 `{ typeA: [...], typeB: [...] }`，直接链式 `.map` 会 TypeError。必须先 `Object.values()` 或用 `partition`/`orderBy` 代替。
4. **cloneDeep vs structuredClone 能力差**：Lodash `cloneDeep` 不支持循环引用外的 DOM/函数/Symbol，但比 `structuredClone` 多了 `customizer` 钩子，可以手动处理特殊对象。纯数据优先 `structuredClone`，复杂结构再考虑 Lodash。

## 自测 3 题

**1. 如何让 Lodash 的 `debounce` / `throttle` 正确参与组件生命周期？写出你会怎么封装。**

<details>
<summary>参考答案</summary>

```ts
// 简单 hook 封装
export function useDebounced<T extends (...args: any[]) => any>(
  fn: T,
  wait = 300
): T & { cancel: () => void; flush: () => void } {
  const debouncedRef = useRef<T & { cancel: () => void; flush: () => void }>();

  if (!debouncedRef.current) {
    debouncedRef.current = debounce(fn, wait) as any;
  }

  // 每次 fn 变化重置 debounce
  useEffect(() => {
    debouncedRef.current = debounce(fn, wait) as any;
    return () => debouncedRef.current!.cancel(); // ← 关键！
  }, [fn, wait]);

  return debouncedRef.current!;
}
```

关键点：**组件 unmount 或 fn 变化时必须调 `cancel()`** 清掉定时器队列，否则挂起的回调回来就炸了。

</details>

**2. `memoize` 为什么会泄漏？如何改造让它自动清理？**

<details>
<summary>参考答案</summary>

`memoize` 默认用 `Map` 当缓存池，key 是函数参数的 `toString()`。当参数是对象时：

```ts
const slow = _.memoize((user: { id: number }) => fetchUser(user.id));
slow({ id: 1 }); // key = "[object Object]"（如果没传 resolver）
slow({ id: 1 }); // 不同引用，但 toString 一样 → 命中缓存（好）
// 但实际 lodash 的 key 生成器对对象用的是内部 hash，不同引用会 hash 成不同 key
slow({ id: 1 }); // hash1
slow({ id: 1 }); // hash2 ← 新 key！缓存爆了
```

修复方案：

```ts
// 方案 A：自定义 resolver 用稳定字段当 key
const slow = _.memoize(fetchUser, (user) => String(user.id));

// 方案 B：换 WeakMap（只支持对象 key，自动 GC）
_.memoize.Cache = WeakMap;
// ⚠️ 但 WeakMap key 只能是对象，原始值参数要用 resolver
```

WeakMap 方案最简单，但必须配合 resolver 把原始值参数转成对象。

</details>

**3. 下面两个片段有什么区别？哪个会产生 100KB+ 的 bundle？**

```ts
// 片段 A
import _ from "lodash";
const d = _.debounce(handler, 300);

// 片段 B
import { debounce } from "lodash-es";
const d = debounce(handler, 300);
```

<details>
<summary>参考答案</summary>

**片段 A** 会产生 100KB+ bundle。`import _ from "lodash"` 把整个库挂在 `_` 上，现代打包工具（Vite/Rollup）能做 tree-shaking 的前提是代码是 ESM 且你具名导入，默认导入意味着"我可能用到整个 `_`"，打包工具不会主动删。

**片段 B** `import { debounce } from "lodash-es"` 是 ESM 具名导入，tree-shaking 能精准只留 debounce 及其依赖（约 2~3KB）。

还有一个半吊子的旧写法：

```ts
import debounce from "lodash/debounce"; // ✅ 也能只引入 debounce
```

但项目里混多了就会出现 CJS 模块和 ESM 模块并存、bundle 体积反而更大的奇怪情况。统一用 `lodash-es` 是正道。

</details>
