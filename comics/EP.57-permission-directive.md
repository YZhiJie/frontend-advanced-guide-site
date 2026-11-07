# EP.57 销毁还是隐藏

> 对应正文：[第三十五部分 · 后台管理系统权限方案](../35-admin-system-auth.md#_35-4-按钮级权限指令v-permission)

## 剧情回顾

- **第 1 格**：标签君用 `display: none` 隐藏无权限按钮，结果发现 Tab 键还能聚焦到它、`querySelector` 还能选中它、甚至还能触发点击——隐藏只是视觉上不可见，元素还在 DOM 里。
- **第 2 格**：码叔讲正确做法是**销毁**（`removeChild`），无权限的元素直接从 DOM 移除，不可聚焦、不可选中。用注释节点占位便于调试。
- **第 3 格**：像素酱验证 `v-permission` 支持四种绑定形态——单条字符串、数组（任一）、`{any}`、`{all}`，判定逻辑 `checkPermission` 只有一份，按钮/接口/守卫复用。
- **第 4 格**：码叔结案——前端按钮隐藏只是体验优化，真正的安全边界在后端接口层；Vue 用指令、React 用 Hook/HOC，判定逻辑都调同一个纯函数。

## 知识点拆解

### 第 1 格 · 隐藏不是销毁

```js
// ❌ 反模式：display:none 隐藏
el.style.display = 'none'
// 元素还在 DOM 里：
// 1. Tab 键可聚焦 → 可访问性问题
// 2. querySelector 可选中 → 脚本可访问
// 3. click 事件仍可触发 → 安全隐患
```

隐藏只是视觉上不可见，元素仍然是 DOM 的一部分。对于权限控制来说，这等于「把门帘拉上但门锁没锁」。

### 第 2 格 · 销毁才是正解

```ts
function removeIfNoPermission(el, binding, owned) {
  if (!checkPermission(binding, owned)) {
    const placeholder = document.createComment(`permission denied: ${binding}`)
    el.parentNode.replaceChild(placeholder, el)
  }
}
```

用 `replaceChild` 把元素替换成注释节点：①元素从 DOM 移除，不可聚焦、不可选中；②注释占位便于调试——审查元素时能看到「这里被权限拦截了」。

### 第 3 格 · 四种绑定形态

```ts
export type PermissionBinding =
  | string              // v-permission="'user:edit'"
  | string[]            // v-permission="['user:edit','user:delete']"  任一
  | { any: string[] }   // 显式任一
  | { all: string[] }   // 显式全部

function checkPermission(binding, owned) {
  if (typeof binding === "string")
    return hasPermission(binding, owned)
  if (Array.isArray(binding))
    return binding.some(code => hasPermission(code, owned))
  if ("any" in binding)
    return binding.any.some(code => hasPermission(code, owned))
  if ("all" in binding)
    return binding.all.every(code => hasPermission(code, owned))
  return false
}
```

判定逻辑只有一份，按钮显隐、路由拦截、接口防误调三处复用。

### 第 4 格 · 前端只是体验层

| 层 | 作用 | 可信度 |
| ---- | ---- | ---- |
| 前端按钮 | 体验优化（不让用户看到无权限按钮） | 不可信 |
| 接口网关 | 校验权限码，不匹配返回 403 | 可信 |
| 数据层 | 按数据范围拼 where 条件 | 可信 |

前端按钮控制只是「门帘」，后端接口校验才是「门锁」。攻击者可以直接调接口、改 DOM、绕过按钮，所以接口层必须独立校验权限码。

## 坑点清单

> 🔗 正文对照：[《35.8 本章避坑清单》](../35-admin-system-auth#_35-8-本章避坑清单)

1. **按钮级用 `display:none` 隐藏**：元素仍在 DOM，可聚焦/选中/点击。用 `removeChild` 销毁。
2. **用 MutationObserver 监听 display**：observer 未清理 → 内存泄漏/状态错乱。一次性销毁即可，不需要监听。
3. **只靠前端按钮控制，接口不校验**：攻击者可直接调接口越权。接口层必须独立校验权限码。
4. **Vue/React 各写一份判定逻辑**：逻辑分叉容易不一致。抽成 `checkPermission` 纯函数，框架层只调用。

## 自测 3 题

**1. 按钮级权限为什么要用「销毁」（removeChild）而不是「隐藏」（display:none）？**

<details>
<summary>参考答案</summary>

隐藏只是视觉上不可见，元素仍在 DOM 中：①仍可被 Tab 键聚焦，影响可访问性；②仍可被 `querySelector` 选中并触发点击，存在安全隐患；③仍占布局空间。销毁直接把元素从 DOM 移除，不可聚焦、不可选中、不占布局，是按钮级权限的正确姿势。
</details>

**2. `v-permission` 指令支持哪几种绑定形态？判定逻辑为什么要抽成纯函数？**

<details>
<summary>参考答案</summary>

四种形态：①单条字符串 `'user:edit'`；②数组 `['user:edit','user:delete']`（满足任一）；③`{any: [...]}`（显式任一）；④`{all: [...]}`（全部满足）。判定逻辑抽成纯函数是为了**复用**——按钮显隐、路由拦截、接口防误调三处都需要判断权限，共用一份逻辑避免不一致，也便于单元测试。
</details>

**3. 为什么说「前端按钮控制只是体验优化，真正的安全边界在后端」？**

<details>
<summary>参考答案</summary>

前端代码运行在用户浏览器里，完全不可信——攻击者可以直接调接口（绕过按钮）、修改 DOM（显示隐藏的按钮）、篡改请求参数。前端按钮隐藏只是为了不让普通用户困惑（看不到无权限的按钮），真正的安全边界在后端：接口网关必须校验权限码（不匹配返回 403），数据层必须按数据范围过滤。前端是门帘，后端才是门锁。
</details>
