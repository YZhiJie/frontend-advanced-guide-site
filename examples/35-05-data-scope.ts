// 文件: examples/35-05-data-scope.ts
// ============ 超级管理员 + 数据权限范围 ============
// 功能权限（按钮/菜单）解决"能不能操作"，数据权限解决"能操作哪些数据"。
// 常见数据范围：全部 / 本部门 / 本部门及以下 / 仅本人 / 自定义部门集合。
// 超管（isSuperAdmin）绕过所有判定，返回 "all"。

import {
  collectPermissions,
  type User,
  type Role,
} from "./35-01-rbac-model.js";

/** 数据范围类型 */
export type DataScope =
  | "all"
  | "dept"
  | "dept_and_children"
  | "self"
  | "custom";

export interface DataScopeRole extends Role {
  dataScope: DataScope;
  customDeptIds?: string[]; // dataScope=custom 时生效
}

export interface DataScopeUser extends User {
  deptId: string;
  deptPath?: string[]; // 部门层级路径（含祖先），如 ["总部", "研发部", "前端组"]
}

/**
 * 解析用户的数据范围。
 * - 超管 → all；
 * - 多角色取"最大范围"（all > dept_and_children > dept > custom > self）；
 * - custom 合并所有角色的 customDeptIds。
 */
const SCOPE_RANK: Record<DataScope, number> = {
  all: 4,
  dept_and_children: 3,
  dept: 2,
  custom: 1,
  self: 0,
};

export interface ResolvedDataScope {
  scope: DataScope;
  deptId: string;
  deptPath: string[];
  customDeptIds: string[];
}

export function resolveDataScope(
  user: DataScopeUser,
  roles: readonly DataScopeRole[],
): ResolvedDataScope {
  if (user.isSuperAdmin) {
    return {
      scope: "all",
      deptId: user.deptId,
      deptPath: user.deptPath ?? [],
      customDeptIds: [],
    };
  }

  let maxScope: DataScope = "self";
  const customDeptIds = new Set<string>();

  for (const roleId of user.roleIds) {
    const role = roles.find((r) => r.id === roleId);
    if (!role) continue;
    if (SCOPE_RANK[role.dataScope] > SCOPE_RANK[maxScope]) {
      maxScope = role.dataScope;
    }
    if (role.dataScope === "custom" && role.customDeptIds) {
      role.customDeptIds.forEach((id) => customDeptIds.add(id));
    }
  }

  return {
    scope: maxScope,
    deptId: user.deptId,
    deptPath: user.deptPath ?? [],
    customDeptIds: [...customDeptIds],
  };
}

/**
 * 把数据范围翻译成"可访问的部门 ID 集合"，供后端 SQL where 条件使用。
 * 这是纯函数，前端也可用它做列表预过滤（但后端必须再次校验，前端过滤不可信）。
 */
export function resolveAccessibleDeptIds(
  resolved: ResolvedDataScope,
): string[] {
  switch (resolved.scope) {
    case "all":
      return ["*"]; // 后端识别 "*" 为不过滤
    case "dept":
      return [resolved.deptId];
    case "dept_and_children":
      // 返回部门路径上的所有部门（含自身及子部门，这里简化为路径上的全部）
      return resolved.deptPath;
    case "custom":
      return resolved.customDeptIds;
    case "self":
    default:
      return [resolved.deptId]; // self 实际由后端按 userId 过滤，这里返回部门仅作占位
  }
}

// ---------------- 验证 ----------------

const roles: DataScopeRole[] = [
  {
    id: "r_admin",
    name: "系统管理员",
    permissionCodes: ["user:*"],
    dataScope: "all",
  },
  {
    id: "r_dept_manager",
    name: "部门主管",
    permissionCodes: ["user:view"],
    dataScope: "dept_and_children",
  },
  {
    id: "r_staff",
    name: "普通员工",
    permissionCodes: ["user:view"],
    dataScope: "self",
  },
  {
    id: "r_auditor",
    name: "审计",
    permissionCodes: ["audit:view"],
    dataScope: "custom",
    customDeptIds: ["d_finance", "d_ops"],
  },
];

const staff: DataScopeUser = {
  id: "u1",
  name: "Alice",
  roleIds: ["r_staff"],
  deptId: "d_fe",
  deptPath: ["d_head", "d_rd", "d_fe"],
};
const manager: DataScopeUser = {
  id: "u2",
  name: "Bob",
  roleIds: ["r_dept_manager"],
  deptId: "d_rd",
  deptPath: ["d_head", "d_rd"],
};
const auditor: DataScopeUser = {
  id: "u3",
  name: "Carol",
  roleIds: ["r_auditor"],
  deptId: "d_fe",
  deptPath: ["d_head", "d_rd", "d_fe"],
};
const superAdmin: DataScopeUser = {
  id: "u0",
  name: "root",
  roleIds: [],
  isSuperAdmin: true,
  deptId: "d_head",
  deptPath: ["d_head"],
};

console.log("=== 普通员工数据范围 ===");
console.log(resolveDataScope(staff, roles));
// { scope: 'self', deptId: 'd_fe', deptPath: [...], customDeptIds: [] }

console.log("\n=== 部门主管数据范围 ===");
const mgrScope = resolveDataScope(manager, roles);
console.log("scope:", mgrScope.scope); // dept_and_children
console.log("可访问部门:", resolveAccessibleDeptIds(mgrScope)); // [ 'd_head', 'd_rd' ]

console.log("\n=== 审计（自定义范围） ===");
const auditScope = resolveDataScope(auditor, roles);
console.log("scope:", auditScope.scope); // custom
console.log("可访问部门:", resolveAccessibleDeptIds(auditScope)); // [ 'd_finance', 'd_ops' ]

console.log("\n=== 超管数据范围 ===");
const saScope = resolveDataScope(superAdmin, roles);
console.log("scope:", saScope.scope); // all
console.log("可访问部门:", resolveAccessibleDeptIds(saScope)); // [ '*' ]

console.log("\n=== 安全提醒 ===");
console.log(
  "前端的 resolveAccessibleDeptIds 仅用于列表预过滤/展示，后端必须独立校验数据范围",
);
console.log(
  "绝不能信任前端传来的 deptIds——越权漏洞往往出在『前端传什么后端查什么』",
);
