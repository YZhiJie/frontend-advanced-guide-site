// 文件: examples/35-02-dynamic-menu.ts
// ============ 动态菜单：按权限码过滤菜单树 ============
// 关键点：
// 1) 前端维护"完整菜单树"（静态定义），后端只返回当前用户的权限码列表；
// 2) 用权限码过滤树——节点无 permissionCode 表示登录可见，有则必须命中；
// 3) 父节点若所有子节点都被过滤掉，则父节点自身也隐藏（避免空菜单）；
// 4) 超管（权限码含 "*"）直接返回整棵树。

import { matchRule } from "./35-01-rbac-model.js";

export interface MenuNode {
    id: string;
    title: string;
    path?: string;
    permissionCode?: string;
    children?: MenuNode[];
}

/** 判断单条权限码是否被持有 */
function isAllowed(code: string, owned: readonly string[]): boolean {
    return owned.some((o) => matchRule(code, o));
}

/**
 * 按权限过滤菜单树。
 * - owned 含 "*" 直接返回原树（超管）；
 * - 节点无 permissionCode → 登录可见；
 * - 节点有 permissionCode 但未命中 → 剔除；
 * - 父节点子节点全被剔除 → 父节点也剔除（避免出现空菜单组）。
 */
export function filterMenu(menu: readonly MenuNode[], owned: readonly string[]): MenuNode[] {
    if (owned.includes("*")) return menu.map((m) => ({ ...m }));

    const result: MenuNode[] = [];
    for (const node of menu) {
        // 先递归过滤子节点
        const children = node.children ? filterMenu(node.children, owned) : undefined;
        const hasVisibleChild = children && children.length > 0;

        // 自身权限判断
        const selfAllowed = node.permissionCode ? isAllowed(node.permissionCode, owned) : true;

        if (selfAllowed || hasVisibleChild) {
            result.push({
                ...node,
                ...(children !== undefined ? { children } : {}),
            });
        }
    }
    return result;
}

// ---------------- 验证 ----------------

const fullMenu: MenuNode[] = [
    {
        id: "dashboard",
        title: "仪表盘",
        path: "/dashboard",
        // 无 permissionCode → 登录可见
    },
    {
        id: "system",
        title: "系统管理",
        children: [
            { id: "user", title: "用户管理", path: "/system/user", permissionCode: "user:view" },
            { id: "role", title: "角色管理", path: "/system/role", permissionCode: "role:view" },
            { id: "menu", title: "菜单管理", path: "/system/menu", permissionCode: "menu:view" },
        ],
    },
    {
        id: "order",
        title: "订单中心",
        children: [
            { id: "order-list", title: "订单列表", path: "/order/list", permissionCode: "order:view" },
            { id: "order-refund", title: "退款审核", path: "/order/refund", permissionCode: "order:refund" },
            { id: "order-export", title: "导出订单", path: "/order/export", permissionCode: "order:export" },
        ],
    },
    {
        id: "finance",
        title: "财务报表",
        path: "/finance",
        permissionCode: "finance:view",
    },
];

// 运营：只读用户 + 订单全权
const opsPerms = ["user:view", "order:*"];
console.log("=== 运营可见菜单 ===");
console.log(JSON.stringify(filterMenu(fullMenu, opsPerms), null, 2));
/*
[
  { id: 'dashboard', title: '仪表盘', path: '/dashboard' },
  {
    id: 'system',
    title: '系统管理',
    children: [ { id: 'user', title: '用户管理', path: '/system/user', permissionCode: 'user:view' } ]
  },
  {
    id: 'order',
    title: '订单中心',
    children: [
      { id: 'order-list', ... permissionCode: 'order:view' },
      { id: 'order-refund', ... permissionCode: 'order:refund' },
      { id: 'order-export', ... permissionCode: 'order:export' }
    ]
  }
]
*/
// 注意：财务报表被隐藏，系统管理只剩用户管理（角色/菜单管理被剔除）

// 超管
console.log("\n=== 超管可见菜单（全量） ===");
const filteredBySuper = filterMenu(fullMenu, ["*"]);
console.log("菜单总数:", filteredBySuper.length); // 4（全部保留）

// 只读用户：只能看仪表盘 + 订单列表
const viewerPerms = ["order:view"];
console.log("\n=== 只读用户可见菜单 ===");
console.log(filterMenu(fullMenu, viewerPerms).map((m) => m.title));
// [ '仪表盘', '订单中心' ] （订单中心只有列表，退款/导出被剔除）
