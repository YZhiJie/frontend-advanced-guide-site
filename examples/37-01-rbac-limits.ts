// 文件: examples/37-01-rbac-limits.ts
// ============ RBAC 的天花板：角色爆炸问题 ============
// RBAC 里权限只跟"角色"挂钩。一旦规则引入"资源属性"或"环境属性"，
// 就只能为每种组合新建角色——角色数量随维度相乘爆炸。
// ABAC 的解法：不再问"你是什么角色"，改问"你的属性满不满足规则"。

export interface Doc {
    id: string;
    title: string;
    ownerDept: string;
    ownerId: string;
    /** 敏感级：public < internal < confidential */
    sensitivity: "public" | "internal" | "confidential";
}

export interface User {
    id: string;
    name: string;
    dept: string;
    level: number;          // 职级
    roles: string[];
}

/** 纯 RBAC：只有"角色 → 文档类型"一张映射表，无法表达"只能看本部门" */
export function rbacCanRead(user: User, _doc: Doc): boolean {
    return user.roles.includes("doc-reader");
}

/** 规则开始掺入属性：想限制"仅本部门可见"→ 只能造新角色 */
export function rbacCanReadV2(user: User, doc: Doc): boolean {
    if (user.roles.includes("doc-reader-global")) return true;
    if (user.roles.includes("doc-reader-own-dept") && user.dept === doc.ownerDept) return true;
    // 每多一个维度就要多一个角色和一条 if —— 组合爆炸从这里开始
    return false;
}

/** ABAC：一条策略规则搞定，用属性表达，不再新增角色 */
export type Predicate = (u: User, d: Doc) => boolean;

export interface AbacRule {
    name: string;
    effect: "allow" | "deny";
    when: Predicate;
}

export function abacCanRead(rules: readonly AbacRule[], user: User, doc: Doc): boolean {
    // deny 优先：任一 deny 命中即拒绝；否则任一 allow 命中即放行；默认拒绝
    if (rules.some((r) => r.effect === "deny" && r.when(user, doc))) return false;
    return rules.some((r) => r.effect === "allow" && r.when(user, doc));
}

// ---------------- 验证 ----------------

const doc: Doc = { id: "d1", title: "Q3 复盘", ownerDept: "rd", ownerId: "u1", sensitivity: "internal" };
const alice: User = { id: "u1", name: "Alice", dept: "rd", level: 5, roles: ["doc-reader-own-dept"] };
const mallory: User = { id: "u9", name: "Mallory", dept: "sales", level: 5, roles: ["doc-reader-own-dept"] };

console.log("=== 纯 RBAC：有角色就能看，管不了部门 ===");
console.log("sales 的 Mallory 能看 rd 的文档?", rbacCanRead(mallory, doc)); // true（泄露！）

console.log("\n=== RBAC 补丁：造新角色 ===");
console.log("本部门 Alice:", rbacCanReadV2(alice, doc)); // true
console.log("外部门 Mallory:", rbacCanReadV2(mallory, doc)); // false

console.log("\n=== ABAC：属性规则化 ===");
const rules: AbacRule[] = [
    {
        name: "confidential 仅本人可见",
        effect: "deny",
        when: (u, d) => d.sensitivity === "confidential" && d.ownerId !== u.id,
    },
    {
        name: "本部门或职级 ≥ 8 可读 internal 及以下",
        effect: "allow",
        when: (u, d) => d.sensitivity !== "confidential" && (u.dept === d.ownerDept || u.level >= 8),
    },
];
console.log("本部门 Alice 读 internal:", abacCanRead(rules, alice, doc)); // true
console.log("外部门 Mallory 读 internal:", abacCanRead(rules, mallory, doc)); // false
const secret: Doc = { ...doc, id: "d2", sensitivity: "confidential", ownerId: "u2" };
console.log("Alice 读他人 conf 机密（deny 规则优先）:", abacCanRead(rules, alice, secret)); // false

console.log("\n=== 角色爆炸 vs 规则数量 ===");
console.log("RBAC 扩展：部门(10) × 敏感级(3) × 时段(2) =", 10 * 3 * 2, "种角色组合");
console.log("ABAC 扩展：3 条规则（每条一个谓词）");
