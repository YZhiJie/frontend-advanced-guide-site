// 文件: examples/35-01-rbac-model.ts
// ============ RBAC 核心模型：用户 → 角色 → 权限码 → 菜单 ============
// 设计原则：
// 1) 角色只作为"权限的集合容器"，前端不直接判断角色名，只识别权限码（permissionCode）；
// 2) 权限码用 "资源:动作" 格式（user:edit），"*" 为超管，"资源:*" 为该资源全权；
// 3) 新增角色只改后端的 角色-权限 关系，前端无需改动；
// 4) 超管（isSuperAdmin）绕过所有判定，避免 "*" 权限码被误回收。

/** 权限码匹配：判断单条需求权限是否被某条持有权限满足 */
export function matchRule(required: string, owned: string): boolean {
    if (owned === "*") return true;
    if (required === owned) return true;
    if (owned.endsWith(":*")) {
        return required.startsWith(owned.slice(0, -1)); // 截掉 "*"，保留 "user:"
    }
    return false;
}

/** 当前用户是否拥有某条权限 */
export function hasPermission(required: string, owned: readonly string[]): boolean {
    return owned.some((rule) => matchRule(required, rule));
}

// ---------------- 数据模型 ----------------

export interface Permission {
    code: string;        // 权限码，如 user:edit
    name: string;        // 可读名称
}

export interface Role {
    id: string;
    name: string;
    permissionCodes: string[]; // 该角色持有的权限码
}

export interface User {
    id: string;
    name: string;
    roleIds: string[];
    isSuperAdmin?: boolean;
}

export interface MenuItem {
    id: string;
    title: string;
    path?: string;
    permissionCode?: string; // 访问该菜单所需权限；不写表示登录即可见
    children?: MenuItem[];
}

// ---------------- 角色 → 权限码合并 ----------------

/** 把用户的多个角色合并成一份去重的权限码列表；超管直接返回 ["*"] */
export function collectPermissions(user: User, roles: readonly Role[]): string[] {
    if (user.isSuperAdmin) return ["*"];
    const set = new Set<string>();
    for (const roleId of user.roleIds) {
        const role = roles.find((r) => r.id === roleId);
        if (!role) continue;
        for (const code of role.permissionCodes) set.add(code);
    }
    return [...set];
}

// ---------------- 验证 ----------------

const roles: Role[] = [
    { id: "r_admin", name: "系统管理员", permissionCodes: ["user:*", "role:*", "menu:*"] },
    { id: "r_ops", name: "运营", permissionCodes: ["user:view", "order:*", "order:refund"] },
    { id: "r_finance", name: "财务", permissionCodes: ["order:view", "order:export", "finance:*"] },
];

const admin: User = { id: "u1", name: "Alice", roleIds: ["r_admin"] };
const ops: User = { id: "u2", name: "Bob", roleIds: ["r_ops"] };
const opsFinance: User = { id: "u3", name: "Carol", roleIds: ["r_ops", "r_finance"] };
const superAdmin: User = { id: "u0", name: "root", roleIds: [], isSuperAdmin: true };

console.log("=== 角色合并权限码 ===");
console.log("admin:", collectPermissions(admin, roles));
// [ 'user:*', 'role:*', 'menu:*' ]
console.log("ops+finance:", collectPermissions(opsFinance, roles));
// [ 'user:view', 'order:*', 'order:refund', 'order:view', 'order:export', 'finance:*' ]
console.log("superAdmin:", collectPermissions(superAdmin, roles));
// [ '*' ]

console.log("\n=== 权限判定（只认权限码，不认角色名） ===");
const opsPerms = collectPermissions(ops, roles);
console.log("ops 能否删除用户?", hasPermission("user:delete", opsPerms)); // false
console.log("ops 能否退款?", hasPermission("order:refund", opsPerms));     // true
console.log("ops 能否导出订单?", hasPermission("order:export", opsPerms)); // false（只有 order:* 但无 export？）
// 注意：order:* 已覆盖 order:export，所以应为 true
console.log("ops 能否查看财务报表?", hasPermission("finance:view", opsPerms)); // false

console.log("\n=== 关键设计：新增角色无需改前端 ===");
// 后端新增角色 r_auditor { permissionCodes: ['audit:view'] }
// 前端 collectPermissions / hasPermission 完全不用改——它只消费权限码列表
const auditor: User = { id: "u4", name: "Dave", roleIds: ["r_auditor"] };
const rolesWithAuditor = [...roles, { id: "r_auditor", name: "审计", permissionCodes: ["audit:view"] }];
console.log("auditor 权限:", collectPermissions(auditor, rolesWithAuditor));
// [ 'audit:view' ]
console.log("auditor 能否审计?", hasPermission("audit:view", collectPermissions(auditor, rolesWithAuditor))); // true
