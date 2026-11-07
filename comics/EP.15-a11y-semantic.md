# EP.15 可访问性与语义化

> 对应正文：[15-accessibility-i18n.md](../15-accessibility-i18n.md)（15.1 可访问性基础：语义化优先 / 15.2 键盘可达与焦点管理 / 15.3 ARIA 实战模式）· 示例：`examples/15-01-semantic.html`、`examples/15-03-focus-trap.tsx`

## 剧情回顾

- **第 1 格**：标签君用 `<div onClick>` 做的"按钮"，Tab 聚焦不了、读屏念成普通文本。
- **第 2 格**：码叔揭秘原生 `<button>`：role、Tab 焦点、Enter 触发、禁用态全部免费。
- **第 3 格**：像素酱实证焦点管理：Modal 打开焦点进入并循环，Esc 关闭后归还触发者。
- **第 4 格**：码叔结案——ARIA 第一规则：能用原生元素，就别用 ARIA。

## 知识点拆解

### 第 1 格 · div 假按钮丢了什么

```jsx
// ❌ 视觉是按钮，语义、键盘、读屏三不沾
<div onClick={submit}>提交</div>
```

- 不可 Tab 聚焦，键盘用户无法操作；
- 屏幕阅读器念成"提交，文本"而非"提交，按钮"；
- Enter/Space 不触发，没有禁用态、没有原生焦点环——补全这些等于手写半个浏览器。

### 第 2 格 · 语义化是免费的 A11y

```jsx
// ✅ 一个标签，全平台自动正确
<button onClick={submit}>提交</button>
```

- 无障碍树由 DOM 语义自动生成：`nav/main/article/h1-h6/ul/button/a` 各有角色；
- 布局元素用语义标签（`header/main.section`）比一堆 `div + class` 更利于读屏跳转；
- 标题层级（h1→h2 不跳级）是读屏用户的"目录"。

### 第 3 格 · 键盘可达与焦点管理

- **可见焦点环**：`outline: none` 必须配自定义焦点样式，否则键盘用户找不到当前位置；
- **焦点陷阱（Focus Trap）**：Modal 打开时记住触发元素 → 焦点移入弹窗 → Tab/Shift+Tab 在弹窗内循环 → Esc 关闭 → 焦点归还；
- **Skip Link**：页面首个可聚焦元素"跳到主内容"，键盘用户不必连按 40 次 Tab 越过导航。

### 第 4 格 · ARIA 的正确用法

- ARIA 第一规则：**能用原生就不用 ARIA**——手写的 `role="button"` 还要补 tabindex、键盘事件、禁用态；
- 只在原生无法表达时补 ARIA：`aria-expanded`（折叠面板）、`aria-live`（异步提示播报）、`aria-label`（图标按钮命名）；
- 常见反模式：`role` 与行为不一致、`aria-hidden` 盖住可聚焦元素。

## 坑点清单

> 🔗 正文对照：[《15.7 本章避坑清单》](../15-accessibility-i18n#_15-7-本章避坑清单)

1. `div onClick` 模拟按钮：键盘不可达、读屏无语义，换成 `<button>` 立刻全好；
2. 弹窗不管焦点：打开后焦点留在背景里，Tab 键走出弹窗背后，关闭后焦点丢失；
3. 滥用 ARIA 炫技：`tabindex` 正数、重复 role、无键盘行为配合，反而制造混乱。

## 自测 3 题（含答案）

1. 为什么不要用 div 模拟按钮？——**丢失原生 role、键盘聚焦/触发、禁用态与焦点环，辅助技术无法识别**。
2. 焦点陷阱的完整流程？——**记住触发元素→打开时焦点移入→Tab 在弹层内循环→Esc 关闭→焦点归还触发元素**。
3. ARIA 第一规则是什么？典型该用 ARIA 的场景？——**能用原生元素就不用 ARIA；原生无法表达时如 aria-expanded、aria-live、图标按钮 aria-label**。
