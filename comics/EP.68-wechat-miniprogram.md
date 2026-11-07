# EP.68 小程序的双线程秘密

> 对应正文：[94-wechat-miniprogram.md](../94-wechat-miniprogram.md)（94.1 双线程模型 / 94.2 生命周期 / 94.4 分包 / 94.5 登录）· 示例：`examples/94-01-wechat-miniprogram.ts`

## 剧情回顾

- **第 1 格**：setData 频繁全量传导致页面卡顿。
- **第 2 格**：码叔揭秘双线程模型——逻辑层(JSCore)与渲染层(WebView)隔离，setData 是唯一通道。
- **第 3 格**：像素酱实证生命周期顺序与登录流程。
- **第 4 格**：码叔结案——分包策略与组件通信（properties+triggerEvent）。

## 知识点拆解

### 第 1 格 · setData 性能

- 双线程间数据需序列化传输；
- 全量 `setData(this.data)` 浪费；
- 应用路径更新只传变化字段，单次 < 256KB。

### 第 2 格 · 双线程模型

```
逻辑层(JSCore) ←setData→ 渲染层(WebView)
```

- 逻辑层跑 JS，渲染层渲染 WXML；
- 两层隔离，setData 是唯一通信通道；
- 用路径 `"user.name"` 更新嵌套字段。

### 第 3 格 · 生命周期与登录

- Page：onLoad→onShow→onReady→onHide→onUnload；
- 登录：`wx.login()`→code→后端`code2session`换 openid→签发 token。

### 第 4 格 · 分包与组件通信

- 主包≤2MB 放首屏+tabBar，分包按需加载；
- 父→子用 properties，子→父用 triggerEvent。

## 坑点清单

> 🔗 正文对照：[《94.7 本章避坑清单》](../94-wechat-miniprogram#_94-7-本章避坑清单)

1. `setData(this.data)` 全量传 → 用路径只传变化字段；
2. `list[0].name` 不生效 → 小程序用 `list.0.name`；
3. onUnload 不清定时器 → 内存泄漏。

## 自测 3 题（含答案）

1. 小程序为什么用双线程模型？——**安全管控：逻辑层无 DOM/BOM，渲染层隔离，防止直接操作 DOM**。
2. Page 生命周期顺序？——**onLoad→onShow→onReady→onHide→onUnload**。
3. 小程序分包大小限制？——**主包≤2MB，单分包≤2MB，总包≤20MB**。
