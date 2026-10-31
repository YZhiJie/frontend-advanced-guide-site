// 文件: examples/37-03-policy-dsl.ts
// ============ 策略 JSON DSL：让权限规则变成数据 ============
// 把策略从"代码里的函数"变成"可下发的 JSON"：
// - 后端可以运营化地增删规则，前端不用发版；
// - 规则可序列化 → 可审计、可 diff、可灰度；
// - 求值器只有一份（本文件的 evaluate），规则只是数据。
// 支持的操作符：eq / neq / in / gt / gte / lt / lte / contains / isOwner / truthy
// 属性路径：subject.dept / resource.ownerDept / env.hour …（点路径取值）

export type Operator =
  | "eq"
  | "neq"
  | "in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "isOwner"
  | "truthy";

export interface Condition {
  left?: string; // 属性路径（嵌套 conditions 时可省）
  op?: Operator;
  right?: unknown; // 字面量（isOwner/truthy 不需要）
  /** 多条件关系：and（默认）/ or */
  combinator?: "and" | "or";
  /** 嵌套子条件 */
  conditions?: Condition[];
}

export interface PolicyJson {
  id: string;
  effect: "allow" | "deny";
  /** 规则适用的动作与资源类型 */
  action: string | string[];
  resourceType: string;
  condition: Condition;
}

export interface Fact {
  subject: Record<string, unknown>;
  resource: Record<string, unknown> & { ownerId: string };
  action: string;
  env: Record<string, unknown>;
}

/** 点路径取值：subject.dept → fact.subject.dept */
function getPath(fact: Fact, path: string): unknown {
  const [root, ...rest] = path.split(".");
  const base: Record<string, unknown> = {
    subject: fact.subject,
    resource: fact.resource,
    env: fact.env,
    action: fact.action,
  };
  return rest.reduce<unknown>(
    (acc, k) => (acc as Record<string, unknown>)?.[k],
    base[root],
  );
}

/** 单条件求值 */
export function evalCondition(cond: Condition, fact: Fact): boolean {
  if (cond.conditions) {
    const results = cond.conditions.map((c) => evalCondition(c, fact));
    return cond.combinator === "or"
      ? results.some(Boolean)
      : results.every(Boolean);
  }
  if (!cond.left || !cond.op) return false; // 既无嵌套也无叶条件 → 视为不满足
  const left = getPath(fact, cond.left);
  const right = cond.right;
  switch (cond.op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "in":
      return Array.isArray(right) && right.includes(left as never);
    case "gt":
      return (left as number) > (right as number);
    case "gte":
      return (left as number) >= (right as number);
    case "lt":
      return (left as number) < (right as number);
    case "lte":
      return (left as number) <= (right as number);
    case "contains":
      return Array.isArray(left) && left.includes(right as never);
    case "isOwner":
      return fact.subject.userId === fact.resource.ownerId;
    case "truthy":
      return Boolean(left);
    default:
      return false; // 未知操作符一律 false（默认拒绝原则）
  }
}

/** 策略命中判定：动作与资源类型匹配且条件为真 */
export function matchPolicy(policy: PolicyJson, fact: Fact): boolean {
  const actions = Array.isArray(policy.action)
    ? policy.action
    : [policy.action];
  return (
    actions.includes(fact.action) &&
    policy.resourceType === fact.resource.type &&
    evalCondition(policy.condition, fact)
  );
}

/** PDP：deny 优先，默认拒绝 */
export function evaluate(
  policies: readonly PolicyJson[],
  fact: Fact,
): { allowed: boolean; by: string | null } {
  const denied = policies.find(
    (p) => p.effect === "deny" && matchPolicy(p, fact),
  );
  if (denied) return { allowed: false, by: denied.id };
  const allowed = policies.find(
    (p) => p.effect === "allow" && matchPolicy(p, fact),
  );
  return allowed
    ? { allowed: true, by: allowed.id }
    : { allowed: false, by: null };
}

// ---------------- 验证 ----------------

const policies: PolicyJson[] = [
  {
    id: "allow-own-edit",
    effect: "allow",
    action: "edit",
    resourceType: "doc",
    condition: { left: "resource", op: "isOwner" },
  },
  {
    id: "allow-dept-or-senior",
    effect: "allow",
    action: "read",
    resourceType: "doc",
    condition: {
      combinator: "or",
      conditions: [
        { left: "subject.dept", op: "eq", right: "rd" },
        { left: "subject.level", op: "gte", right: 8 },
      ],
    },
  },
  {
    id: "deny-big-amount-junior",
    effect: "deny",
    action: "approve",
    resourceType: "payment",
    condition: { left: "resource.amount", op: "gt", right: 100000 },
  },
];

const fact1: Fact = {
  subject: { userId: "u1", dept: "rd", level: 5 },
  resource: { type: "doc", ownerId: "u1", sensitivity: "internal" },
  action: "edit",
  env: {},
};
const fact2: Fact = {
  subject: { userId: "u2", dept: "sales", level: 9 },
  resource: { type: "doc", ownerId: "u1", sensitivity: "internal" },
  action: "read",
  env: {},
};
const fact3: Fact = {
  subject: { userId: "u2", dept: "sales", level: 5 },
  resource: { type: "payment", ownerId: "u1", amount: 500000 },
  action: "approve",
  env: {},
};

console.log("owner 编辑自己的文档:", evaluate(policies, fact1)); // allow-own-edit
console.log("非本部门但职级 9 读文档（or 条件）:", evaluate(policies, fact2)); // allow-dept-or-senior
console.log("职级 5 审批 50w（deny 优先）:", evaluate(policies, fact3)); // deny-big-amount-junior

console.log("\n=== 策略是数据：可直接 JSON 下发与审计 ===");
console.log(JSON.stringify(policies[1], null, 2));
