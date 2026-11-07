// 文件: examples/35-04-permission-directive.ts
// ============ 按钮级权限指令（v-permission）核心逻辑 ============
// 反模式：用 MutationObserver 强制 display:none 隐藏元素
//   问题：①隐藏而非销毁 → 元素仍占布局、仍可被 tab 聚焦、仍可被脚本访问；
//        ②observer 未清理 → 内存泄漏 / 状态错乱。
// 正确策略：一次性 removeChild（销毁），无权限直接从 DOM 移除。
// 本文件演示框架无关的判定与"销毁"逻辑，Vue/React 各层负责把 el 传进来。

import { hasPermission } from "./35-01-rbac-model.js";

/** 权限指令的绑定值类型 */
export type PermissionBinding =
    | string                              // 单条权限码：v-permission="'user:edit'"
    | string[]                            // 满足任一：v-permission="['user:edit', 'user:delete']"
    | { any: string[] }                   // 显式"任一"
    | { all: string[] };                  // 显式"全部"

/** 解析 binding，返回是否有权限 */
export function checkPermission(binding: PermissionBinding, owned: readonly string[]): boolean {
    if (typeof binding === "string") {
        return hasPermission(binding, owned);
    }
    if (Array.isArray(binding)) {
        return binding.some((code) => hasPermission(code, owned));
    }
    if ("any" in binding) {
        return binding.any.some((code) => hasPermission(code, owned));
    }
    if ("all" in binding) {
        return binding.all.every((code) => hasPermission(code, owned));
    }
    return false;
}

/**
 * 销毁无权限元素（框架无关的 DOM 操作）。
 * 用注释节点占位，便于调试时定位"这里被权限拦截了"。
 * 框架层（Vue directive / React HOC）只负责在挂载时调用此函数。
 */
export function removeIfNoPermission(el: HTMLElement, binding: PermissionBinding, owned: readonly string[]): void {
    if (!checkPermission(binding, owned)) {
        const placeholder = document.createComment(`permission denied: ${JSON.stringify(binding)}`);
        el.parentNode?.replaceChild(placeholder, el);
    }
}

// ---------------- 验证（无 DOM 环境，只验证判定逻辑） ----------------

const opsPerms = ["user:view", "order:*"];

console.log("=== 单条权限 ===");
console.log("user:view →", checkPermission("user:view", opsPerms));   // true
console.log("user:edit →", checkPermission("user:edit", opsPerms));   // false

console.log("\n=== 数组（满足任一） ===");
console.log("['user:edit','user:delete'] →", checkPermission(["user:edit", "user:delete"], opsPerms)); // false
console.log("['user:view','user:delete'] →", checkPermission(["user:view", "user:delete"], opsPerms)); // true

console.log("\n=== 显式 all（全部满足） ===");
console.log("{all:['user:view','order:view']} →", checkPermission({ all: ["user:view", "order:view"] }, opsPerms)); // true

console.log("\n=== 关键差异：销毁 vs 隐藏 ===");
console.log("隐藏(display:none): 元素仍在 DOM，tab 可聚焦，querySelector 可选中 → 可访问性 & 安全隐患");
console.log("销毁(removeChild):  元素从 DOM 移除，不可聚焦、不可选中 → 按钮级权限的正确姿势");
