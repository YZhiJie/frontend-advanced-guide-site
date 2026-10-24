# EP.38 vdom diff 里的 key 魔法

> 对应正文：[第四部分 · 框架深入理解](../27-mini-framework.md)

## 剧情回顾

- **第 1 格**：标签君写 React 列表渲染——用 index 当 key 一切换顺序全页面闪烁，换成稳定 id 立刻丝滑。为啥 key 能有这么大威力？
- **第 2 格**：码叔点破——diff 算法只在同层节点之间比，key 就是每个节点的"身份证"。`findIndex(c => c.key === k)` 找到相同 key 就原地 patch，找不到就删旧加新。本质是 LCS（最长公共子序列）的贪心近似。
- **第 3 格**：像素酱手写 mini-vdom 的 `h()` 和 `diff()` 跑实证——10 项列表头部插 1 项，有 key 只触发 1 次 createElement；换成 index 当 key 要删 10 个再建 11 个。key 正确时 DOM 操作少 80%。
- **第 4 格**：码叔结案——key 不是随便写的字符串，它定义了"谁和谁是同一个"。四大雷区：别用 index、兄弟节点内必须唯一、不能用每次渲染变的随机数、Fragment 里的列表项也要 key。

## 知识点拆解

### 第 1 格 · key 为什么重要

diff 算法的核心问题：旧节点和新节点怎么"配对"？如果不指定 key，只能按位置硬匹配——第 0 位对第 0 位、第 1 位对第 1 位。当新节点在头部插入时，原来的 A/B/C 就被逼到了 1/2/3 位置，算法以为它们全变成了新元素，于是每个都删掉重建。

### 第 2 格 · 同层 diff 原理

```js
// React/Vue 通用策略：同层 + key 匹配
function diffChildren(oldCh, newCh) {
  for (let i = 0; i < oldCh.length; i++) {
    const k = oldCh[i].key;
    const j = newCh.findIndex(c => c.key === k);
    if (j !== -1) patch(oldCh[i], newCh[j]);
    else unmount(oldCh[i]);
  }
  newCh.forEach(c => mount(c));
}
```

这就是"全量 findIndex"——时间复杂度 O(n²)，但工程上列表一般不长，够用。Vue 3 加了"递增下标优化"，连续 key 直接 O(n) 扫过去。

### 第 3 格 · 实证：80% DOM 操作去哪儿了

```js
// h() 创建 vnode
const v1 = h('ul', null, [
  h('li', { key: 'a' }, 'A'),
  h('li', { key: 'b' }, 'B'),
  h('li', { key: 'c' }, 'C'),
]);

const v2 = h('ul', null, [
  h('li', { key: 'x' }, 'X'), // 新头
  h('li', { key: 'a' }, 'A'),
  h('li', { key: 'b' }, 'B'),
  h('li', { key: 'c' }, 'C'),
]);

diff(v1, v2); // 有 key：createElement × 1
diff(v1, v2); // index key：delete × 3 + create × 4
```

DOM 操作比 JS 慢上百倍（涉及 layout/paint），减少 80% 的 DOM 操作就是从"肉眼可见闪"到"完全无感"。

### 第 4 格 · Fragment key 也是这个道理

React 16 引入的 Fragment（`<>...</>`）本身不产生真实 DOM，但它内部的子节点照样是同层 diff——所以 Fragment 里的列表项同样需要 key。报错信息 "Each child in a list should have a unique 'key' prop" 里的 "child" 就包含了 Fragment 内的节点。

## 坑点清单

> 🔗 正文对照：[《27.7 本章避坑清单》](../27-mini-framework#_27-7-本章避坑清单)

1. **别用数组 index 当 key**：列表顺序一变（排序、插入、删除），每个元素的身份都跟着变，diff 算法全盘重建。只有在列表永不重排（纯静态列表）时 index key 才勉强可用。
2. **兄弟节点内必须唯一**：key 不要求全局唯一，但在同一组兄弟节点里必须唯一。两个节点共用同一个 key，diff 就认不出来谁是谁，行为不可预测。
3. **不要用每次渲染都变的值**：`key={Math.random()}` 或 `key={Date.now()}` 意味着每次 render 所有 key 都变了——等于永远全量重建，性能还不如直接不用 key。
4. **Fragment / 条件渲染里的 key**：`v-if` / `v-show` 切换不同组件时用 key 强制 remount（比如切换 tab 时重置表单）；Fragment 包列表时列表项依然要 key。

## 自测 3 题

**1. 为什么 React/Vue 的 key 只要求"兄弟节点内唯一"，不要求全局唯一？**

<details>
<summary>参考答案</summary>

diff 算法是 **逐层同层比较** 的——它只在同一个父节点的 children 数组里做 key 匹配，不会跨层比较。所以只要在同一父节点下的兄弟节点里 key 不重复，算法就能正确认出每个节点。全局唯一不仅没必要，还可能带来额外的内存开销（比如用 UUID）。
</details>

**2. 下面这段 React 代码，排序时为什么输入框里的内容会跳来跳去？怎么修？**

```jsx
{list.map((item, i) => (
  <input key={i} defaultValue={item.text} />
))}
```

<details>
<summary>参考答案</summary>

用 index 当 key，排序后 DOM 节点和数据项的配对关系错位了。比如原来 index=0 是 item A、index=1 是 item B，排序后 index=0 变成 item B——diff 算法以为这还是原来的那个 DOM 节点，只更新 props 不重建，于是原来 A 输入框里的 DOM 位置现在被 B 的数据"覆盖"了，但用户光标还在老 DOM 节点上，造成内容和焦点错位。

修法：`key={item.id}` 用稳定唯一 id。
</details>

**3. Vue 3 的 `v-for` 官方文档说 "不推荐使用 index 作为 key"，但又说 "如果不提供 key，Vue 会使用 index"。为什么？**

<details>
<summary>参考答案</summary>

Vue 3 的 diff 有"递增下标优化"——当新列表的 key 序列是递增的（比如 key=0,1,2,3），它会认为这是没变化的列表，O(n) 直接复用；但一旦 key 序列不递增（比如排序后变成 3,1,2,0），就退化成普通 key 匹配。所以：
- **不提供 key** = 内部用 index key，递增时 O(n) 复用，性能好；
- **显式写 index key** = 排序时 Vue 仍然认为 key 递增，照样复用错节点；
- **提供稳定 id key** = 无论怎么排序都能正确识别。

官方推荐稳定 id，因为"列表会变"是常态而不是例外。
</details>
