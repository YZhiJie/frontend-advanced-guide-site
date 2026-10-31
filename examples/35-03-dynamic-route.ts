// 文件: examples/35-03-dynamic-route.ts
// ============ 动态路由：按权限注册可访问路由 ============
// 两种主流方案：
// 方案 A（推荐）：前端静态定义完整路由表，后端返回"可访问的路由 name 列表"，
//                前端按 name 过滤后注册。新增角色/菜单无需改前端组件映射。
// 方案 B：后端直接下发"可访问菜单树 + componentKey"，前端用 componentMap 映射。
//         缺点：后端新增菜单必须前端补 componentMap，耦合高，不推荐。
// 本示例演示方案 A。

import { hasPermission } from "./35-01-rbac-model.js";

export interface AppRoute {
    name: string;       // 路由唯一标识（后端用 name 控制可见性）
    path: string;
    component: string;  // 组件标识（前端内部映射到实际 import，不暴露给后端）
    permissionCode?: string;
    meta?: { title: string };
    children?: AppRoute[];
}

/**
 * 按权限过滤路由表（方案 A）。
 * 后端只需返回当前用户的 permissionCodes，前端用它过滤静态路由表。
 * 无 permissionCode 的路由 = 登录即可访问。
 */
export function filterRoutes(
    routes: readonly AppRoute[],
    permissionCodes: readonly string[],
): AppRoute[] {
    const result: AppRoute[] = [];
    for (const route of routes) {
        const children = route.children ? filterRoutes(route.children, permissionCodes) : undefined;
        const selfAllowed = route.permissionCode
            ? hasPermission(route.permissionCode, permissionCodes)
            : true;
        if (selfAllowed) {
            result.push({ ...route, ...(children !== undefined ? { children } : {}) });
        }
    }
    return result;
}

/**
 * 路由守卫（框架无关纯函数）：
 * - 未登录 → 跳登录页并携带 redirect；
 * - 已登录但无该路由权限 → 拒绝（前端展示 403）；
 * - 登录且有权限 → 放行。
 */
export type GuardResult =
    | { type: "allow" }
    | { type: "redirect"; to: string }
    | { type: "forbidden" };

export function guardRoute(
    route: AppRoute,
    ctx: { isAuthenticated: boolean; permissionCodes: readonly string[]; loginPath: string; currentPath: string },
): GuardResult {
    if (!ctx.isAuthenticated) {
        const from = encodeURIComponent(ctx.currentPath);
        return { type: "redirect", to: `${ctx.loginPath}?redirect=${from}` };
    }
    if (route.permissionCode && !hasPermission(route.permissionCode, ctx.permissionCodes)) {
        return { type: "forbidden" };
    }
    return { type: "allow" };
}

// ---------------- 验证 ----------------

const allRoutes: AppRoute[] = [
    { name: "dashboard", path: "/dashboard", component: "Dashboard", meta: { title: "仪表盘" } },
    {
        name: "system",
        path: "/system",
        component: "Layout",
        children: [
            { name: "system-user", path: "/system/user", component: "UserList", permissionCode: "user:view", meta: { title: "用户管理" } },
            { name: "system-role", path: "/system/role", component: "RoleList", permissionCode: "role:view", meta: { title: "角色管理" } },
            { name: "system-menu", path: "/system/menu", component: "MenuList", permissionCode: "menu:view", meta: { title: "菜单管理" } },
        ],
    },
    {
        name: "order",
        path: "/order",
        component: "Layout",
        children: [
            { name: "order-list", path: "/order/list", component: "OrderList", permissionCode: "order:view", meta: { title: "订单列表" } },
            { name: "order-export", path: "/order/export", component: "OrderExport", permissionCode: "order:export", meta: { title: "导出订单" } },
        ],
    },
];

const opsPerms = ["user:view", "order:*"];

console.log("=== 运营可注册路由 ===");
const opsRoutes = filterRoutes(allRoutes, opsPerms);
console.log(JSON.stringify(opsRoutes.map((r) => r.name), null, 2));
// ["dashboard", "system", "order"]
// system 下只有 user，order 下有 list + export（order:* 覆盖）

console.log("\n=== 路由守卫三态 ===");
const ctx = { isAuthenticated: true, permissionCodes: opsPerms, loginPath: "/login", currentPath: "/system/role" };
const roleRoute = allRoutes[1].children![1];
console.log("访问 /system/role（需 role:view）:", guardRoute(roleRoute, ctx));
// { type: 'forbidden' }

const userRoute = allRoutes[1].children![0];
console.log("访问 /system/user（需 user:view）:", guardRoute(userRoute, ctx));
// { type: 'allow' }

const guestCtx = { ...ctx, isAuthenticated: false, currentPath: "/dashboard" };
console.log("未登录访问 /dashboard:", guardRoute(allRoutes[0], guestCtx));
// { type: 'redirect', to: '/login?redirect=%2Fdashboard' }

console.log("\n=== 方案 A 的核心优势 ===");
console.log("后端新增角色 → 只改 角色-权限 关系表，前端 filterRoutes/guardRoute 零改动");
console.log("后端新增菜单 → 只需在前端静态路由表补一条（组件映射在前端，可控）");
