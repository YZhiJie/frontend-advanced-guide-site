# EP.56 路由那道门卫

> 对应正文：[第三十五部分 · 后台管理系统权限方案](../35-admin-system-auth.md#_35-3-动态路由与路由守卫)

## 剧情回顾

- **第 1 格**：像素酱登录后直接在地址栏输入 `/system/role`，一刷新就跳到 404——因为 `/:pathMatch(.*)*` 通配路由在动态路由之前注册了，刷新时动态路由还没来得及 `addRoute` 就被 404 截走。
- **第 2 格**：码叔讲路由守卫的三态设计——`allow`（放行）、`redirect`（未登录跳登录页，携带 `redirect` 参数）、`forbidden`（已登录但无权限，展示 403）。守卫必须是纯函数，不调用框架 API，Vue/React 各调一次。
- **第 3 格**：标签君对比两种动态路由方案——方案 A（前端静态路由表 + 权限过滤）vs 方案 B（后端下发菜单树 + componentMap）。方案 A 的组件映射在前端，新增角色前端零改动；方案 B 后端加菜单必须前端补映射，耦合高。
- **第 4 格**：码叔结案——404 通配路由必须最后注册；`beforeEach` 里判断动态路由是否已注册，未注册则拉权限、过滤、`addRoute` 后 `next({ ...to, replace: true })` 重新跳转。

## 知识点拆解

### 第 1 格 · 404 路由注册顺序

```js
// ❌ 错误：404 先注册，动态路由后注册
router.addRoute({ path: '/:pathMatch(.*)*', redirect: '/404' })
// 然后才注册动态路由
router.addRoute(filteredRoutes[i])

// 刷新页面时，动态路由还没注册，请求先命中 404
```

404 通配路由必须在**所有动态路由注册完毕之后**再注册，否则刷新页面会被提前截走。

### 第 2 格 · 守卫三态纯函数

```ts
export type GuardResult =
  | { type: "allow" }
  | { type: "redirect"; to: string }
  | { type: "forbidden" };

export function guardRoute(route, ctx) {
  if (!ctx.isAuthenticated) {
    const from = encodeURIComponent(ctx.currentPath);
    return { type: "redirect", to: `${ctx.loginPath}?redirect=${from}` };
  }
  if (route.permissionCode && !hasPermission(route.permissionCode, ctx.permissionCodes)) {
    return { type: "forbidden" };
  }
  return { type: "allow" };
}
```

守卫只返回**事实**（三态之一），框架层（Vue `beforeEach` / React Router loader）只负责把返回值翻译成跳转行为。这样 Vue 和 React 共用同一份判定逻辑，不会分叉。

### 第 3 格 · 方案 A vs 方案 B

| 方案 | 做法 | 新增菜单 | 新增角色 |
| ---- | ---- | ---- | ---- |
| **A（推荐）** | 前端静态路由表 + 权限码过滤 | 前端加一条配置 | 后端改表，前端零改 |
| B（不推荐） | 后端下发菜单树 + componentKey | 前端补 componentMap | 后端改表 |

方案 B 把组件映射交给后端，后端新增菜单必须前端补 `componentMap`，前后端强耦合。方案 A 的组件映射完全在前端控制，后端只返回权限码。

### 第 4 格 · 动态路由注册时机

```js
router.beforeEach(async (to, from, next) => {
  if (!dynamicRoutesRegistered) {
    const perms = await fetchPermissions()
    const routes = filterRoutes(allRoutes, perms)
    routes.forEach(r => router.addRoute(r))
    router.addRoute({ path: '/:pathMatch(.*)*', redirect: '/404' }) // 最后注册
    dynamicRoutesRegistered = true
    return next({ ...to, replace: true }) // 重新跳转，让新路由生效
  }
  next()
})
```

关键点：①判断是否已注册，避免重复 `addRoute`；②404 放最后；③用 `replace: true` 重新跳转，不留下历史记录。

## 坑点清单

> 🔗 正文对照：[《35.8 本章避坑清单》](../35-admin-system-auth#_35-8-本章避坑清单)

1. **404 路由注册太早**：动态路由还没 `addRoute`，刷新先命中 `/:pathMatch(.*)`。404 必须最后注册。
2. **动态路由用后端 `componentKey` 映射**：后端新增菜单必须前端补 `componentMap`。用前端静态路由表 + 权限码过滤。
3. **守卫写在框架钩子里不可复用**：Vue/React 各写一份逻辑分叉。守卫抽成纯函数，框架层只调用并翻译返回值。
4. **路由 name 不唯一或用 path 做 key**：`addRoute`/`removeRoute` 按 name 操作，path 可能变。name 必须唯一且稳定。

## 自测 3 题

**1. 为什么 404 通配路由必须在动态路由之后注册？**

<details>
<summary>参考答案</summary>

路由匹配是按注册顺序的。如果 `/:pathMatch(.*)*` 在动态路由之前注册，刷新页面时动态路由还没来得及 `addRoute`，请求就会先命中 404 通配路由，被重定向到 404 页面。正确做法是等所有动态路由 `addRoute` 完毕后，最后再注册 404 通配路由。
</details>

**2. 路由守卫为什么要写成纯函数，而不是直接在 `beforeEach` 里写跳转逻辑？**

<details>
<summary>参考答案</summary>

纯函数守卫只返回 `allow` / `redirect` / `forbidden` 三种结果，不调用任何框架 API。这样：①Vue 和 React 可以共用同一份判定逻辑，不会出现「Vue 改了 React 没改」的分叉；②便于单元测试，传入参数直接断言返回值；③框架层只负责把返回值翻译成行为（`next()` / `redirect()` / 渲染 403），职责清晰。
</details>

**3. 动态路由方案 A（前端静态路由表 + 权限过滤）相比方案 B（后端下发菜单树 + componentMap），核心优势是什么？**

<details>
<summary>参考答案</summary>

方案 A 的组件映射完全在前端控制，后端只返回权限码。新增菜单时只需在前端静态路由表补一条配置，后端无需改动；新增角色时前端完全不用动（只改后端角色-权限表）。方案 B 把菜单结构和组件映射都交给后端，后端新增菜单必须前端补 `componentMap`，前后端强耦合，每次菜单变更都要双端同步发布。
</details>
