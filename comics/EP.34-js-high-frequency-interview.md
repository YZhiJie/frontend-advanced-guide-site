# EP.34 JS 高频面试题通关

> 对应正文：[23-js-high-frequency-interview.md](../23-js-high-frequency-interview.md) · 示例：`examples/23-01-promise-all.ts`、`examples/01-21-deep-clone.ts`、`examples/01-20-debounce-throttle.ts`、`examples/01-11-mybind.ts`、`examples/01-09-instanceof.ts`

## 剧情回顾

- **第 1 格**：像素酱面试被三连击——输出题写不出顺序、this 指向乱套、手写 Promise.all 半天憋不出，背了一堆答案换个写法就懵。
- **第 2 格**：码叔亮出五条运行时主线：事件循环、作用域链、原型链、this 四绑定、Promise 状态机——80% 高频题都能从这五条推导。
- **第 3 格**：标签君默写三大手写：promiseAll 按下标保序 + done 计数、deepClone 用 WeakMap 处理循环引用、debounce 用 clearTimeout 重置，并覆盖空数组 / 循环引用 / this 丢失三大边界。
- **第 4 格**：码叔结案：微任务清空制递归卡死、setTimeout(0) 与 DCL 顺序无规范保证、DCL/load 本质是宏任务、== 隐式转换 null 只等于 undefined——从背答案到推机制。

## 知识点拆解

### 第 1 格 · 为什么背答案换个写法就懵

JS 面试的高频题看似分散（输出题、this、原型、Promise、手写），实则都收敛到**运行时机制**。死记 `setTimeout 比 Promise 慢` 没用，必须理解「宏任务一轮一个、微任务清空制」才能推导任意组合题。同理，this 不是「谁调用指向谁」一句口诀，而是默认/隐式/显式/new 四绑定的优先级判定。

### 第 2 格 · 五条运行时主线

| 主线 | 核心机制 | 覆盖题型 |
| ---- | ---- | ---- |
| 事件循环 | 宏任务→清空微任务→rAF→渲染→下一宏任务 | 输出题、async/await、MutationObserver 时序 |
| 作用域链 | 词法作用域 + 闭包持有外层变量 | var/let/const、闭包、循环闭包陷阱 |
| 原型链 | `__proto__` 向上直到 Object.prototype | 原型关系、instanceof、继承 |
| this 绑定 | 默认 < 隐式 < 显式 < new，箭头函数捕获定义层 | this 输出题、call/apply/bind |
| Promise 状态机 | pending→fulfilled/rejected 不可逆，then 返回新 Promise | Promise 链、Promise.all、async/await |

**关键认知**：两个生命周期事件 DCL/load 不是特殊通道，**它们就是宏任务**——一旦理解这点，它们与 setTimeout/事件回调的顺序问题全部可以用事件循环规则推导，不用背。

### 第 3 格 · 手写题的三大边界

```js
// promiseAll：按下标保序 + done 计数，空数组直接 resolve
results[i] = val;
if (++done === arr.length) resolve(results);

// deepClone：WeakMap 登记循环引用，先登记再递归
if (map.has(obj)) return map.get(obj);
map.set(obj, clone);

// debounce：clearTimeout 重置定时器
clearTimeout(timer);
timer = setTimeout(() => fn.apply(this, args), wait);
```

- **promiseAll 边界**：空数组应直接 `resolve([])`；用 `done` 计数而非判断数组长度（避免稀疏数组坑）；任一失败立即整体 reject；
- **deepClone 边界**：必须先 `map.set` 再递归，否则循环引用找不到已登记副本；Date/RegExp 需特殊处理；
- **myCall 边界**：用 `Symbol` 挂属性形成隐式绑定，用完 delete，避免污染目标对象。

### 第 4 格 · 高频易错点

1. **微任务是清空制**：微任务里注册新微任务会被同一轮继续执行，`Promise.resolve().then(loop)` 递归将永远阻塞渲染——这是微任务死循环卡死页面的根源；
2. **setTimeout(0) 与 DCL 顺序无规范保证**：谁先执行取决于「解析剩余 HTML 时间」与「定时器到点时间」哪个先，小页面 DCL 先，大页面 timeout 可能先；
3. **== 隐式转换**：null 只等于 undefined（且只与彼此相等），`null == 0` 为 false；`[] == ![]` 为 true（![]→false→0，[]→''→0）。

## 坑点清单

> 🔗 正文对照：[《23.14 本章避坑清单》](../23-js-high-frequency-interview#_23-14-本章避坑清单)

1. **微任务递归卡死页面**：大数据分片必须用宏任务（setTimeout/scheduler.yield），不能用 Promise 链递归；
2. **DCL/load 当特殊通道背**：它们是宏任务，与 setTimeout 顺序靠事件循环推导，不要背固定顺序；
3. **手写 promiseAll 用数组长度判断完成**：稀疏数组（`new Array(3)`）length 为 3 但元素为空，必须用 done 计数；
4. **deepClone 递归后才登记 WeakMap**：循环引用会无限递归，必须先 `map.set` 再递归子属性；
5. **myCall 用字符串 key 挂属性**：会与目标对象已有属性冲突，必须用 `Symbol` 且用完 delete。

## 自测 3 题（含答案）

1. **为什么 `Promise.resolve().then(loop)` 会卡死页面，而 `setTimeout(loop, 0)` 不会？**——微任务队列是清空制：微任务里注册的新微任务会在同一轮清空中继续执行，循环注册将永远阻塞，渲染和后续宏任务都得不到执行。宏任务是一轮一个，每轮之间浏览器有渲染机会，所以页面不卡。
2. **`setTimeout(fn, 0)` 和 `DOMContentLoaded` 监听器，哪个先执行？**——无规范保证。setTimeout(0) 在内联脚本执行时入队计时，DCL 在 HTML 解析完成时入队派发，谁先到点谁先执行。小页面解析快，DCL 通常先；大页面或慢设备上 timeout 可能先。
3. **手写 `promiseAll` 时，为什么要用 `done` 计数而不是 `results.length === arr.length`？**——如果用 `new Array(arr.length)` 创建稀疏数组，length 虽然等于 arr.length 但元素全是空位，赋值后 `results.length` 不会变化，导致判断永远成立或永远不成立。用 `done` 计数器每次成功 +1，精确到第 arr.length 次成功时才 resolve，避免稀疏数组和顺序错乱问题。
