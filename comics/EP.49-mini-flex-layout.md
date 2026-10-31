# EP.49 flex 主轴交叉轴那点事

> 对应正文：[第二十八部分 · 手写浏览器内核](../28-mini-browser-engine.md#_28-3-mini-flex-layout-flex-主轴交叉轴)

## 剧情回顾

- **第 1 格**：标签君困惑——写了 `flex: 1 1 auto` 之后，容器里三个 item 基础宽度 150/100/80、容器却只有 300px（总共 330）。加了 flex-shrink 以为大的会多缩点、小的少缩点，结果缩完三个 item 宽度差距还是很小——这 shrink 怎么还"劫富济贫"没济好？
- **第 2 格**：码叔点破 flex 主轴分配三阶段：① 按 flex-basis 给每个 item 基础宽度（`auto` = 自身 width）；② 有剩余空间时按 flex-grow 比例分；③ 空间不够时按 **flex-shrink × basis** 的加权比例缩——basis 大的权重高，缩得多。
- **第 3 格**：像素酱手写 layoutFlex() 验证。容器 300px，basis 150/100/80，shrink 各 1，总 shrink 权重 330。需减 30px：item1 缩 150×30/330≈13.6 → 得 136.4；item2 缩 100×30/330≈9.1 → 得 90.9；item3 缩 80×30/330≈7.3 → 得 72.7。大的确实多缩了。
- **第 4 格**：码叔结案——三个最坑：flex-basis 默认 `auto` 不是 0；shrink 加权公式是 `shrink × basis` 不是均等；`min-width` 默认 `auto` 会阻止 item shrink 到比内容还小（这也是"为什么我设了 shrink: 1 还是没缩"的根源）。

## 知识点拆解

### 第 1 格 · 三属性别混为一谈

flex-grow / flex-shrink / flex-basis 各自分工，**不写就是默认值**：

```css
flex: 1;       /* = flex-grow: 1; flex-shrink: 1; flex-basis: 0% */
flex: auto;    /* = flex-grow: 1; flex-shrink: 1; flex-basis: auto */
flex: initial; /* = 0 1 auto  ← 浏览器默认 */
```

`flex-basis: 0` 才会让 grow 真的按 grow 比例等分空间；`basis: auto` 时 grow 只是"增加"，不是"从零分"。

### 第 2 格 · 手写 layoutFlex 核心

```js
function layoutFlex(container, items, axis) {
  const totalSize = axis === 'main' ? container.width : container.height;

  // 阶段 1：基础宽度
  for (const item of items) {
    item.basis = item.flexBasis === 'auto'
      ? item[axis === 'main' ? 'width' : 'height']
      : item.flexBasis;
    item.size = item.basis;
  }

  let remaining = totalSize - items.reduce((s, i) => s + i.size, 0);

  // 阶段 2：grow（空间充足）
  if (remaining > 0) {
    const totalGrow = items.reduce((s, i) => s + i.flexGrow, 0);
    if (totalGrow > 0) {
      for (const item of items) {
        item.size += (item.flexGrow / totalGrow) * remaining;
      }
      remaining = 0;
    }
  }

  // 阶段 3：shrink（空间不够）
  if (remaining < 0) {
    const totalShrink = items.reduce(
      (s, i) => s + i.flexShrink * i.basis, 0
    );
    if (totalShrink > 0) {
      for (const item of items) {
        const ratio = (item.flexShrink * item.basis) / totalShrink;
        item.size += ratio * remaining; // remaining 是负数
      }
    }
  }
}
```

### 第 3 格 · shrink 加权公式

`shrinkWeight = flexShrink × basis`，然后按比例分摊缩减量。这就是为什么「基础宽度大的 item 缩得多」——因为 shrink 不是均等缩减，是按 basis 加权。

特殊细节：CSS 规范在 shrink 时还会 clamp item 到 `min-width`（默认 `auto` = 内容最小宽度），防止缩到内容以下。手写 layout 时必须遵守这点。

### 第 4 格 · 三个最坑

1. **`flex: 1` vs `flex: auto`**：前者 basis 为 0（从头分），后者 basis 为自身 width（从现有大小往外加）。这俩在"等分"场景表现完全不同。
2. **`min-width: auto` 是默认值**：它等于 item 的内容最小宽度。如果想让 item 真的能缩到 0，显式写 `min-width: 0`。这是 CSS Flex 里被问烂了的一道面试题。
3. **`flex-shrink` 只在空间不够时生效**：grow 和 shrink 是互斥的——容器够大时 shrink 不参与分配，不够大时 grow 也不参与。

## 坑点清单

> 🔗 正文对照：[《28.7 本章避坑清单》](../28-mini-browser-engine#_28-7-本章避坑清单)

1. **`min-width: auto` 阻止 shrink**：浏览器默认给 flex item 加了 `min-width: auto`，等于内容最小宽度。想让 item 能缩到 0，必须显式 `min-width: 0`。这是 flex 经典「为什么我设了 `flex: 1` 还是没等分」的根源。
2. **`flex-basis` 优先级高于 `width`**：只要写了 `flex-basis`（非 `auto`），`width`/`height` 就被忽略。很多人写了 `width: 100px; flex: 1` 以为 shrink 从 100px 起，其实 basis 是 0%，grow 是 1——从头分。
3. **`flex: 0 0 100px` 才是固定宽度 item**：想让某个 item 完全不参与 grow/shrink 变化，三个值都要显式设。只写 `width: 100px` 遇到容器小了还是会被 shrink。
4. **shrink 加权有 clamp**：CSS 规范里 shrink 不能让 item 缩到 `min-width` 以下，手写 flex 引擎必须遵守这点，不然会出现负数或内容溢出。

## 自测 3 题

**1. `flex: 1` 和 `flex: auto` 在等分场景下表现有什么区别？为什么？**

<details>
<summary>参考答案</summary>

| 属性 | `flex: 1` | `flex: auto` |
| ---- | --------- | ------------ |
| 等价 | `1 1 0%` | `1 1 auto` |
| basis | **0** | 自身的 width/height |
| 等分 | 三个 item 容器 300px → 每个 100px ✓ | 三个 item 原宽 150/100/80 → 先按原宽给，再分剩余 30px → 每个约 +10 → 160/110/90 ✗ |

**原因**：grow 只分配"剩余空间"。basis 为 0 时剩余空间 = 全部容器空间，grow 直接等分；basis 为 auto 时剩余空间 = 容器 - 各 item 原宽之和，grow 只分那一小撮剩余。想等分就用 `flex: 1`（即 `1 1 0%`）。

</details>

**2. 容器 400px，三个 item：basis 200/100/80，shrink 分别 1/2/1，不够时 shrink 后各自最终宽度是多少？**

<details>
<summary>参考答案</summary>

```js
总 basis = 200 + 100 + 80 = 380  ← 等等，这不够啊
容器 400 > 380，剩余 = 20px → 进入 grow 阶段，不走 shrink

换容器 300px 的场景：
需缩减 = 380 - 300 = 80px
shrink 权重 = 1×200 : 2×100 : 1×80 = 200 : 200 : 80 = 480
item1 缩减 = 80 × 200/480 = 33.3  → 200 - 33.3 = 166.7px
item2 缩减 = 80 × 200/480 = 33.3  → 100 - 33.3 =  66.7px
item3 缩减 = 80 ×  80/480 = 13.3  →  80 - 13.3 =  66.7px

// 验证：166.7 + 66.7 + 66.7 ≈ 300 ✓
```

关键：**shrink 权重 = flexShrink × basis**，不是只用 flexShrink 本身。上题里 item2 的 shrink 是 item1 的两倍，但 basis 只有一半——乘起来两者权重相等，所以缩得一样多。

</details>

**3. 为什么我给 flex item 设了 `flex: 0 1 200px` 但容器缩小时它还是会被压到比 200px 小？`min-width: auto` 默认值在这里起了什么作用？**

<details>
<summary>参考答案</summary>

这个场景的 shrink 公式是：
- item 的基础宽 = 200px
- 有空间压力时 shrink 权重生效，会试图把 item 从 200 往下缩
- **但 CSS 规范在 shrink 之前先 clamp 到 `min-width`（默认 `auto`）**
- `min-width: auto` 等于 item 的 **内容最小宽度**（比如内容是 "Hello" 就是字体渲染宽度）

所以如果内容最小宽度 < 200，item 还是会被 shrink——直到被内容宽度卡住为止。想让 item 真的固定 200px 不缩，写法是：

```css
.item {
  flex: 0 0 200px;  /* shrink: 0，直接不参与缩减 */
  /* 或者 */
  min-width: 200px; /* 硬卡 min-width */
}
```

</details>
