// 文件: examples/37-02-abac-model.ts
// ============ ABAC 模型：主体 / 客体 / 环境 / 动作 ============
// ABAC 用四类属性描述一次访问请求，策略对属性做匹配：
// - Subject 主体：用户自身属性（部门/职级/是否 owner）
// - Object  客体：资源属性（所属部门/敏感级/金额）
// - Action  动作：read / edit / approve / delete
// - Environment 环境：时间 / IP / 风险等级
// 架构上分两层：PDP（策略决策点，只算"允许吗"）与 PEP（策略执行点，各处拦截器）。
// PEP 只问 PDP，不自己实现规则——判定逻辑全站唯一。

export interface Subject {
    userId: string;
    dept: string;
    level: number;
    riskScore: number;      // 环境侧输入：账号风险分
}

export interface Resource {
    type: "order" | "doc" | "payment";
    ownerId: string;
    ownerDept: string;
    sensitivity: "public" | "internal" | "confidential";
    amount?: number;        // order/payment 特有
}

export interface Action {
    name: "read" | "edit" | "approve" | "delete";
}

export interface Environment {
    now: Date;
    ipInternal: boolean;    // 是否公司内网
}

export interface AccessRequest {
    subject: Subject;
    resource: Resource;
    action: Action;
    env: Environment;
}

/** 策略：target 命中范围 + condition 满足条件 → effect */
export interface Policy {
    id: string;
    description: string;
    effect: "allow" | "deny";
    target: (req: AccessRequest) => boolean;    // 这条策略管哪些请求
    condition: (req: AccessRequest) => boolean; // 命中后进一步判断
}

/** PDP：策略决策点。deny 优先，默认拒绝 */
export function decide(policies: readonly Policy[], req: AccessRequest): { allowed: boolean; by: string } {
    const hit = policies.filter((p) => p.target(req));
    const denied = hit.find((p) => p.effect === "deny" && p.condition(req));
    if (denied) return { allowed: false, by: denied.id };
    const allowed = hit.find((p) => p.effect === "allow" && p.condition(req));
    return allowed ? { allowed: true, by: allowed.id } : { allowed: false, by: "default-deny" };
}

// ---------------- 策略库 ----------------

export const policies: Policy[] = [
    {
        id: "p-own-edit",
        description: "资源的 owner 可以编辑",
        effect: "allow",
        target: (r) => r.action.name === "edit",
        condition: (r) => r.subject.userId === r.resource.ownerId,
    },
    {
        id: "p-dept-read",
        description: "本部门可读 internal 及以下",
        effect: "allow",
        target: (r) => r.action.name === "read" && r.resource.sensitivity !== "confidential",
        condition: (r) => r.subject.dept === r.resource.ownerDept,
    },
    {
        id: "p-high-approve",
        description: "金额 > 10 万的审批需要职级 ≥ 8 且内网",
        effect: "allow",
        target: (r) => r.action.name === "approve" && (r.resource.amount ?? 0) > 100_000,
        condition: (r) => r.subject.level >= 8 && r.env.ipInternal,
    },
    {
        id: "p-risk-deny",
        description: "高风险账号（风险分 ≥ 70）禁止一切写操作",
        effect: "deny",
        target: (r) => r.action.name !== "read",
        condition: (r) => r.subject.riskScore >= 70,
    },
];

// ---------------- 验证 ----------------

const env: Environment = { now: new Date("2026-10-22T10:00:00"), ipInternal: true };

function req(partial: Partial<AccessRequest> & { subject: Subject; resource: Resource }): AccessRequest {
    return {
        action: { name: "read" },
        env,
        ...partial,
    } as AccessRequest;
}

const alice: Subject = { userId: "u1", dept: "rd", level: 9, riskScore: 10 };
const hacked: Subject = { userId: "u1", dept: "rd", level: 9, riskScore: 85 };

const ownDoc: Resource = { type: "doc", ownerId: "u1", ownerDept: "rd", sensitivity: "internal" };
const otherDoc: Resource = { type: "doc", ownerId: "u2", ownerDept: "sales", sensitivity: "internal" };
const bigOrder: Resource = { type: "order", ownerId: "u2", ownerDept: "sales", sensitivity: "internal", amount: 500_000 };

console.log("=== PDP 决策（deny 优先 → allow → 默认拒绝） ===");
console.log("Alice 编辑自己的文档:", decide(policies, req({ subject: alice, resource: ownDoc, action: { name: "edit" } })));
console.log("Alice 编辑他人文档:", decide(policies, req({ subject: alice, resource: otherDoc, action: { name: "edit" } })));
console.log("Alice 读 sales 文档（跨部门）:", decide(policies, req({ subject: alice, resource: otherDoc })));
console.log("总监审批 50w 订单（内网）:", decide(policies, req({ subject: alice, resource: bigOrder, action: { name: "approve" } })));
console.log("高风险账号编辑（deny 优先）:", decide(policies, req({ subject: hacked, resource: ownDoc, action: { name: "edit" } })));

console.log("\n=== PEP 只问 PDP：任何拦截器长一个样 ===");
console.log(`
function pepGuard(req: AccessRequest) {
    const { allowed, by } = decide(policies, req);
    if (!allowed) throw new ForbiddenError(by); // 统一 403，带策略 id 便于审计
}`);
