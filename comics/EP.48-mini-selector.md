# EP.48 .a .b 为啥慢

> 对应正文：[第二十八部分 · 手写浏览器内核](../28-mini-browser-engine.md#_28-2-mini-selector-selector-匹配从哪一头开始)

## 剧情回顾

- **第 1 格**：标签君困惑——页面加了 `.row .cell span.icon[data-role="item"][data-deep]` 选择器后卡成 PPT。后代选择器越写越长、属性选择器越写越多，浏览器到底在忙啥？
- **第 2 格**：码叔点破——浏览器引擎做 selector matching 时用的是 BOF（Bottom-Up Matching）：**从右往左**匹配 selector 片段。比如 `body div span`，先从 DOM 里找所有 `span` 节点，再对每个 span 往上追 parent div，再往上追 parent body。
- **第 3 格**：像素酱手写 matcher 验证——3000 个 span 节点的 DOM，`body div span` 右向左扫只用 12ms；反过来左向右扫要 128ms。差 10 倍的原因：右向左只遍历目标元素集合大小，左向右要从根扫全部后代。
- **第 4 格**：码叔结案——三条忠告：别碰 `*` 通配符（每个节点都要试）；后代选择器嵌套别超 3 层（每层加一次父链遍历）；属性选择器别用复杂正则。

## 知识点拆解

### 第 1 格 · Selector Performance 不是玄学

浏览器引擎内部的 CSS selector matching 经历过多次算法演进（Quirks / Gecko / WebKit / Bloom Filter），但**通用的匹配方向是自右向左**这条始终成立。原因简单：DOM size 通常远大于 selector 长度。

### 第 2 格 · BOF 算法

```js
// selector: [body, div, span]  从右向左
function matchSelector(node, selectorList) {
  // selectorList = ['body', 'div', 'span']
  let current = node; // 从 DOM 节点出发
  for (let i = selectorList.length - 1; i >= 0; i--) {
    const expected = selectorList[i];
    if (!matchesSimple(current, expected)) return false;
    if (i > 0) {
      current = current.parentElement; // 往上走
      if (!current) return false;
    }
  }
  return true;
}
```

`matchesSimple` 负责单片段匹配：tag name / class / id / attribute / pseudo-class。每个节点只算一次。

### 第 3 格 · 为什么右向左更快

假设 DOM 有 10000 节点，其中 3000 个 span，selector 是 `body div span`：

| 方向 | 遍历起点 | 遍历范围 | 耗时 |
| ---- | -------- | -------- | ---- |
| **BOF（右→左）** | 先找全部 span | 3000 个 span × 平均父链深度 | 12ms |
| NOF（左→右） | 从 body 开始 | body 的全部后代（接近 10000 个节点）都要试能不能匹配最后一个 span | 128ms |

这就是为什么「简单 selector 快、嵌套多了慢」。

### 第 4 格 · 三条忠告

1. **别用通配符 `*`**：`body * span` 的最右片段是 `span` 还好，但 `body *` 最右是 `*`——意味着每个 DOM 节点都要往上追。
2. **后代嵌套别超 3 层**：每层加一次父链遍历。`body .container .row .cell span` 如果页面深，span 的父链本身就长。
3. **属性选择器别用复杂模式**：`[data-xxx*="complex-regex"]` 里的正则开销 + 必须遍历每个带该属性的元素。

## 坑点清单

> 🔗 正文对照：[《28.7 本章避坑清单》](../28-mini-browser-engine#_28-7-本章避坑清单)

1. **`*` 通配符是性能核弹**：当它出现在 selector 的右侧片段时，DOM 中每个节点都要参与匹配——等于 DOM size × selector length 的复杂度。
2. **属性选择器代价高**：简单精确匹配 `[role="button"]` 还好；通配 `[data-*]`、正则 `[data-name~="..."]`、复杂字符串匹配开销显著。
3. **动态 DOM 的重匹配**：每次 DOM 变化（inserted / removed / class changed），浏览器要对受影响子树重新跑 selector matching——复杂 selector 在频繁更新的页面会持续拖慢。
4. **伪类别乱加**：`:hover`、`:active` 等 UI 触发伪类在高频事件中会触发重匹配。`:nth-child()`、`:not()`、`:is()` 这类结构/组合伪类本身就需要额外遍历。

## 自测 3 题

**1. 为什么浏览器引擎选择「从右向左」匹配 selector，而不是「从左向右」？**

<details>
<summary>参考答案</summary>

- **DOM size 远大于 selector length**：selector 通常几到十几个片段，而 DOM 节点可能几千几万；
- BOF 先定位**目标元素集合**（最右片段），集合大小通常比全 DOM 小得多；
- 对目标集合内每个节点**向上遍历父链**——父链深度是树高 logN，远好于全扫 O(N)；
- 如果反过来从 body 向下找 span，要遍历 body 的所有后代再逐个判断是不是 span——O(N)，而且很多节点根本不关心。

</details>

**2. 手写一个 BOF 风格的 selector matcher，支持后代选择器和类选择器 `.a .b`。**

<details>
<summary>参考答案</summary>

```js
// 把 'div.container span.icon' 拆成 ['div.container', 'span.icon']
function parseSelector(sel) {
  return sel.trim().split(/\s+/);
}

// 简单片段匹配：'div.container' 匹配 tag 为 div 且 class 含 container
function matchSimple(el, fragment) {
  let node = el;
  for (const frag of fragment.split('.')) {
    if (!frag) continue;
    if (/^[a-zA-Z]/.test(frag)) {
      if (node.tagName.toLowerCase() !== frag) return false;
    } else {
      if (!node.classList.contains(frag)) return false;
    }
  }
  return true;
}

// 主匹配函数
function matches(el, selector) {
  const fragments = parseSelector(selector);
  let current = el;
  // 从右向左遍历
  for (let i = fragments.length - 1; i >= 0; i--) {
    if (!matchSimple(current, fragments[i])) return false;
    if (i > 0) {
      current = current.parentElement;
      if (!current) return false;
    }
  }
  return true;
}
```

</details>

**3. 浏览器引擎用了哪些加速技巧让 selector matching 变快？**

<details>
<summary>参考答案</summary>

- **Bloom Filter 预筛**：对 DOM 节点的 tag/class/id 用 Bloom Filter 做快速 pre-check，80% 不可能命中的节点直接跳过；
- **Selector 分组**：按最右片段分桶（按 tag、class、id 分组），只对桶内元素执行完整匹配；
- **命中缓存**：同一个 selector 在同一个 DOM 上重复命中时直接复用结果（匹配结果缓存）；
- **动态变化增量更新**：只重新匹配 DOM 变化的子树，不是全树再跑一遍；
- **Fast Path 专门优化**：对常见简单 selector（`#id`、`.class`、`tag`）做 O(1) 快速路径。

</details>
