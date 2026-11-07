# EP.39 Proxy 里偷偷收集依赖

> 对应正文：[第四部分 · 框架深入理解](../27-mini-framework.md)

## 剧情回顾

- **第 1 格**：标签君手写 reactive——`new Proxy(obj, { set: ... })` 只在 set 里改了属性就 return，页面纹丝不动。他的 effect 根本没被触发，因为 Proxy 里没人"跟踪" effect 在看哪个属性。
- **第 2 格**：码叔点破——三条流水线串起 reactivity：`activeEffect` 栈（当前正在执行的 effect）、`Deps = Map(target, Map(key, Set(effect)))`（每个属性盯着哪些 effect）、Proxy 的 get/set 陷阱。get 里 `track(target, key)` 把 activeEffect 塞进 Dep；set 里 `trigger(target, key)` 把 Dep 里所有 effect 拉出来重跑。
- **第 3 格**：像素酱跑完整 reactive——`state = reactive({a:1, b:2})`，effect 里读 `state.a + state.b` 输出 3；`state.a = 5` 后自动输出 7。Vue 的 computed/watch/template 全是 effect 的不同马甲。
- **第 4 格**：码叔结案——四个容易漏掉的场景：嵌套对象要递归 reactive；只读属性/frozen 对象不要 trigger；数组的 push/pop 会改 length，也要能触发；`in`/`for-in`/`deleteProperty` 这些陷阱也要 track。

## 知识点拆解

### 第 1 格 · 为什么"只 set 不 get"不行

```js
// 没用的 Proxy
const p = new Proxy(obj, {
  set(t, k, v) { t[k] = v; return true; }
});
effect(() => render(p.a));  // effect 里读了 p.a
p.a = 5;                    // set 里只改了值，不知道该通知谁
```

问题根源：set trap 知道"有人改了属性"，但它不知道"谁在读这个属性"。依赖收集的核心是——**谁在什么时候读了哪些属性**，必须在 get trap 里记录下来。

### 第 2 格 · 依赖收集三件套

```js
let activeEffect = null;
const deps = new Map();   // WeakMap(target → Map(key → Set(effect)))

function track(target, key) {
  if (!activeEffect) return;
  let map = deps.get(target);
  if (!map) deps.set(target, map = new Map());
  let set = map.get(key);
  if (!set) map.set(key, set = new Set());
  set.add(activeEffect);
}

function trigger(target, key) {
  deps.get(target)?.get(key)?.forEach(e => e());
}
```

Proxy：
```js
const proxy = new Proxy(target, {
  get(t, k) { track(t, k); return Reflect.get(t, k); },
  set(t, k, v) { Reflect.set(t, k, v); trigger(t, k); return true; },
});
```

### 第 3 格 · effect 实现里的栈

effect 可能嵌套（effect 里创建 computed，computed 内部又跑一个 effect），所以要用栈：

```js
const effectStack = [];
let activeEffect = null;

function effect(fn) {
  const e = () => {
    effectStack.push(e);
    activeEffect = e;
    try { fn(); } finally {
      effectStack.pop();
      activeEffect = effectStack[effectStack.length - 1] || null;
    }
  };
  e();
}
```

这保证了 effect 执行期间读的属性都被正确记录，嵌套 effect 也不会串。

### 第 4 格 · 数组 & 集合的 Proxy 陷阱

数组的 Proxy 比普通对象麻烦——`arr.push(x)` 会触发 set 陷阱两次：一次是设 `arr[length] = x`，一次是改 `arr.length = length + 1`。Vue 的做法是重写了数组的七个变异方法（push/pop/shift/unshift/splice/sort/reverse），在 push 内部手动 trigger length 相关的依赖。

Map/Set 更复杂——它们有 size 属性、有 add/delete/clear、有 forEach。Vue 3 的 reactive 专门给这些集合类型做了 Proxy 重写。

## 坑点清单

> 🔗 正文对照：[《27.7 本章避坑清单》](../27-mini-framework#_27-7-本章避坑清单)

1. **嵌套对象必须递归 reactive**：`reactive({ nested: { a: 1 } })` 如果只 reactive 第一层，`proxy.nested` 返回的还是原始对象——改它当然不会触发更新。Vue 3 用了"惰性代理"——get trap 里检查返回值，是对象就再次 reactive。
2. **只读对象 / Object.freeze() 不要 trigger**：Vue 3 区分 `reactive` 和 `readonly`。readonly 对象 get 照常 track（以便 derived 数据知道依赖了只读值），但 set/delete 直接 return，不触发任何更新。
3. **数组的 length 和索引**：直接设 `arr.length = 0` 也应该清空所有元素的 effect 依赖；push/unshift 会同时触发索引新增和 length 变更，不能让同一轮 trigger 里 effect 重跑两次。
4. **in / deleteProperty / ownKeys 也要 track**：`'key' in obj` 依赖了 obj 的 key 集合；`delete obj.key` 应该 trigger；`for (const k in obj)` 依赖了所有 key。Vue 的 Proxy 全 trap 都做了 track/trigger。

## 自测 3 题

**1. 为什么 reactive 要用 WeakMap 存 deps 的第一层 key？普通 Map 行不行？**

<details>
<summary>参考答案</summary>

WeakMap 是 key 为对象引用的弱引用容器。当 reactive 的 target 对象被外部释放（没有变量再引用它）时，WeakMap 里的那条 `target → deps map` 会自动被 GC 回收，不会内存泄漏。

如果用普通 Map，target 即使被外部释放了，Map 里的 key 还指着它，就泄漏了。WeakMap 是实现响应式系统的标配——Vue 3、Preact 的 signals、SolidJS 全用它。
</details>

**2. 嵌套 effect 时，activeEffect 的切换怎么保证不串？**

<details>
<summary>参考答案</summary>

用栈：

```js
const stack = [];
let current = null;

function effect(fn) {
  const run = () => {
    stack.push(run);
    current = run;
    fn();
    stack.pop();
    current = stack.at(-1) || null;
  };
  run();
}
```

执行 effect A 时 current = A；A 内部调用 effect B，栈变成 [A, B]，current = B；B 结束后栈弹出，current 回到 A。这样 B 里读的属性被 B 收集，A 里读的属性被 A 收集，互不干扰。
</details>

**3. 怎么让 `reactive([1,2,3])` 里 `a.push(4)` 也能触发依赖？直接靠 Proxy 的 set 陷阱行不行？**

<details>
<summary>参考答案</summary>

直接靠 Proxy set 陷阱理论上可以——`push(4)` 会对 `a[3]` 赋 4、对 `a.length` 赋 4，两次 set 陷阱触发两次。但工程上还有两个问题：

1. **性能**：触发太多次（比如一次 push 触发 n 次）；
2. **依赖完整性**：有人 track 了整个数组（for...of），push 也应该触发。

Vue 3 的做法是重写七个变异方法，在内部手动 trigger：

```js
const arrayMethods = ['push','pop','shift','unshift','splice','sort','reverse'];
arrayMethods.forEach(m => {
  const original = Array.prototype[m];
  arrayMethods[m] = function (...args) {
    const result = original.apply(this, args);
    trigger(this, 'length');
    trigger(this, Symbol.iterator);
    return result;
  };
});
```

这样保证每次 push 只触发一次，且所有类型的依赖都被通知到。
</details>
