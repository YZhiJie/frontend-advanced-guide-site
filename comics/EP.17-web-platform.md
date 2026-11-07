# EP.17 Web 新能力

> 对应正文：[17-web-platform.md](../17-web-platform.md)（17.1 浏览器新能力速查 / 17.2 可视化技术选型 / 17.3 Web Components）· 示例：`examples/17-01-popover.html`、`examples/17-05-web-component.html`

## 剧情回顾

- **第 1 格**：标签君自制下拉弹层：层叠、点外关闭、Esc、焦点、滚动锁，半周还没做全。
- **第 2 格**：码叔揭秘 Popover API：浏览器原生顶层弹层，`popovertarget` 声明即用。
- **第 3 格**：像素酱实证 View Transitions 一行 API 做转场，Web Components 三件套封装原生组件。
- **第 4 格**：码叔结案——可视化按 SVG/Canvas/WebGL 选型，WASM 只对 CPU 密集有收益。

## 知识点拆解

### 第 1 格 · 自制弹层的隐形成本

- z-index 层叠战争、滚动穿透锁定、点击外部关闭、Esc 关闭；
- 焦点管理、可访问性（参照 EP.15）、嵌套层级、定位翻转；
- 这些是「写两天、调两周」的典型功能，且每个团队重写一遍。

### 第 2 格 · Popover API

```html
<button popovertarget="menu">菜单</button>
<div id="menu" popover>…</div>
```

- **顶层（top layer）渲染**：不受任何父级 overflow/z-index 影响；
- 自带：轻关闭（点外部/Esc）、焦点管理、`showPopover()`/`hidePopover()` 方法与 toggle/beforetoggle 事件；
- 与 `<dialog>` 的分工：dialog 是模态会话（有模态背景），popover 是非模态临时浮层。

### 第 3 格 · View Transitions 与 Web Components

- **View Transitions**：`document.startViewTransition(() => updateDOM())`，浏览器自动对新旧状态做截图过渡，配合 `::view-transition-*` CSS 做共享元素动画；
- **Web Components 三件套**：Custom Elements（自定义标签生命周期）+ Shadow DOM（样式与 DOM 封装）+ `<template>`（可复用结构），产出框架无关的组件；
- 浏览器正在把过去必须引框架才能做的事逐步内置。

### 第 4 格 · 可视化选型与 WASM

- **SVG**：节点少、要交互/可访问性（图表、图标），DOM 事件天然可用；
- **Canvas 2D**：节点多但逻辑简单（千级散点、热力图）；
- **WebGL/WebGPU**：海量图元/3D（地图、粒子、三维），通常直接用 Three.js；
- **WASM**：适合编解码、仿真、图像处理等 CPU 密集；对 IO 等待密集场景零收益，还有加载与胶水层成本。

## 坑点清单

> 🔗 正文对照：[《17.6 本章避坑清单》](../17-web-platform#_17-6-本章避坑清单)

1. 所有浮层都手写：焦点/Esc/层叠/滚动锁成本极高，Popover/dialog 能覆盖就别造轮子；
2. 图节点不多却上 Canvas：失去 DOM 可访问性与事件系统，维护成本陡增；
3. 为"性能"上 WASM：瓶颈在网络/IO 时毫无收益，先 profile 再决定。

## 自测 3 题（含答案）

1. Popover 帮你免费解决了哪些问题？——**顶层渲染（无 z-index 战争）、轻关闭（点外部/Esc）、焦点管理**。
2. Web Components 三件套是什么？——**Custom Elements、Shadow DOM、&lt;template&gt;**。
3. SVG/Canvas/WebGL 怎么选？——**少量可交互节点选 SVG；大量 2D 图元选 Canvas；海量图元或 3D 选 WebGL/WebGPU**。
