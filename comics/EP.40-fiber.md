# EP.40 Fiber 为啥长这样

> 对应正文：[第四部分 · 框架深入理解](../27-mini-framework.md)

## 剧情回顾

- **第 1 格**：标签君翻 React 源码，看到 Fiber 节点的 `child / sibling / return` 三指针，懵了——为啥不用常规的 `parent + children[]`？
- **第 2 格**：码叔点破——React 15 的递归 diff 一次走完整棵树，树一大就卡主线程 100ms+。解决方案是**把递归改成可中断循环**。递归的遍历状态靠调用栈维护，循环的遍历状态就得靠数据结构本身维护——这就是 Fiber 链表：`child`（下沉）/`sibling`（右走）/`return`（上升）三指针拼出 DFS 遍历的路径。时间到了 `shouldYield()` 就 break，当前 Fiber 即遍历状态，下次从它继续。
- **第 3 格**：像素酱手写 mini-Fiber——`class Fiber { child, sibling, return, effectTag }`，`beginWork` 创建子 Fiber 并挂上 `return`，`requestIdleCallback` 驱动 workLoop，每次帧只跑 5ms。1000 节点大组件不再卡主线程。
- **第 4 格**：码叔结案——三个容易写错的方向：`child` 指向第一个子节点不是子数组；`return` 指向父 Fiber 不是 DOM；`effectTag` 至少覆盖 place/update/delete 三种 commit 动作；切片预算 5ms 够了，多了反卡。

## 知识点拆解

### 第 1 格 · Fiber 之前的问题

React 15（Stack Reconciler）是递归的：

```js
function reconcileChildren(oldVnode, newVnode) {
  // 递归深入
  newVnode.children.forEach(child => reconcile(child));
}
```

递归的问题：
- 一旦开始就停不下来——JS 调用栈没法暂停；
- 组件树深 1000 层，递归 1000 层直接爆栈；
- 大组件一次 render 卡主线程上百毫秒，用户点按钮点不动。

### 第 2 格 · Fiber = 可中断的 DFS

Fiber 链表把整棵树编码成一个可以从任意节点恢复的 DFS 状态：

```
           A (return=null)
          /
         B (return=A, child=C, sibling=D)
        / \
       C   D (return=B)
      /     \
     E       F (return=D)
```

遍历顺序（DFS 先序）：`A → B → C → E → return 到 C 的 return B → D → F → return`。

用循环写：
```js
let current = root;
while (current) {
  if (shouldYield()) break;  // 可中断点
  current = performUnitOfWork(current);
}
// 恢复时 current 指向哪个节点，就从哪个节点继续
```

### 第 3 格 · beginWork / completeWork / commit

React Fiber 的核心三段式：

1. **beginWork**（构建阶段，可中断）：接收 current Fiber + 新 props，diff 创建子 Fiber（child/sibling 链表），打上 effectTag；返回下一个要处理的 Fiber（优先 child，没有就 sibling，再没有 return + sibling）；
2. **completeWork**（构建阶段，可中断）：自底向上组装——子节点的 DOM 先创建好，父节点把子 DOM append 到自己，冒泡 effect list；
3. **commit**（提交阶段，**不可中断**）：把整轮 effect list 一次性刷到 DOM。commit 分 mutation（改 DOM）和 layout（useLayoutEffect）两阶段，后一个可以读 DOM 布局。

### 第 4 格 · effectTag 是什么

```js
const Placement = 0b0001;
const Update    = 0b0010;
const Deletion  = 0b0100;
const Snapshot  = 0b1000;  // useSnapshot

fiber.effectTag = Placement | Update;  // 位运算组合
```

beginWork 里根据 diff 结果决定 effectTag，commit 阶段遍历 effect list 按 tag 执行对应 DOM 操作。

## 坑点清单

> 🔗 正文对照：[《27.7 本章避坑清单》](../27-mini-framework#_27-7-本章避坑清单)

1. **child ≠ children**：Fiber 只有一个 child 指针（指向第一个子节点），其余子节点通过 sibling 串起来。写 Fiber 树忘了给第二个 child 设置前一个 child 的 sibling，链表就断了。
2. **return 指向的是 Fiber，不是 DOM**：`fiber.stateNode` 才是 DOM 节点或组件实例。`return` 纯粹是为了遍历回溯。
3. **commit 阶段不可中断**：构建阶段（beginWork/completeWork）可以 yield；commit 阶段必须一口气跑完——否则 commit 到一半切走，用户看到 UI 中间态会出错。
4. **时间切片预算**：`frameDeadline.timeRemaining()` 一般剩 1ms 就 yield。给多了（比如 10ms），主线程还是会卡；给少了切换过于频繁反而 overhead 更大。5ms 是工程上比较平衡的数字。

## 自测 3 题

**1. 为什么 Fiber 不用 parent + children[] 的常规树结构，非得搞 child-sibling-return 三指针？**

<details>
<summary>参考答案</summary>

三个原因：
1. **可中断遍历**：递归遍历的状态存在调用栈里，JS 无法暂停调用栈；而 Fiber 的三指针本身就是遍历状态——任何时刻保存当前 Fiber 就能随时恢复；
2. **遍历效率**：DFS 遍历时，常规树结构需要额外的栈（函数栈或手动栈），Fiber 链表"就地"编码了遍历路径，省去了栈的维护开销；
3. **内存更省**：每个 Fiber 节点只存一个 child 指针 + 一个 sibling 指针，比 `children: []` 数组更紧凑，GC 也更友好。

本质上 Fiber 就是**把递归调用栈显式地搬到了数据结构里**。
</details>

**2. workLoop 里 `shouldYield()` 的判断逻辑是什么？时间到了就 break，下次怎么从断点继续？**

<details>
<summary>参考答案</summary>

```js
function workLoop(deadline) {
  while (currentWorkInProgress && !shouldYield(deadline)) {
    currentWorkInProgress = performUnitOfWork(currentWorkInProgress);
  }
  if (currentWorkInProgress) {
    requestIdleCallback(workLoop);  // 还有活，下次继续
  } else {
    commitRoot();
  }
}

function shouldYield(deadline) {
  return deadline.timeRemaining() < 1;  // 剩不到 1ms 就让
}
```

断点恢复：`currentWorkInProgress` 是模块级变量，保存了**最后一个 beginWork 没完成的 Fiber 节点**。下次 workLoop 进来时，从这个节点继续 performUnitOfWork。因为 Fiber 链表是完整的，知道当前节点就知道下一个该处理谁。

关键：beginWork/completeWork 必须是**纯函数**——对同一个 Fiber 多次调用结果一致，这样中途被打断重跑不会出错。
</details>

**3. beginWork 怎么决定"下一个要处理的 Fiber 是谁"？（child / sibling / return 的优先级）**

<details>
<summary>参考答案</summary>

```js
function performUnitOfWork(fiber) {
  beginWork(fiber);  // 创建/更新 fiber.child 链表
  // 优先往下（深度优先）
  if (fiber.child) return fiber.child;
  // 没 child 就找兄弟
  let next = fiber;
  while (next) {
    completeWork(next);
    if (next.sibling) return next.sibling;  // 右走
    next = next.return;                     // 上升再找
  }
  return null;  // 遍历完了
}
```

这个返回值链天然编码了 DFS 先序遍历：child → sibling → return 链上的 sibling。和递归版本的 `dfs(node.children)` 完全等价，只是从"函数调用栈"搬到了 Fiber 链表指针里。
</details>
