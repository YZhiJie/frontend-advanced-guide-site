// 文件: examples/42-02-countersign-routing.ts
// ============ 会签节点与条件路由 ============
// 两种「多人节点」与一种「分流节点」：
// 1) 会签 all：全员同意才过，任一否决即否决（一票否决）；
// 2) 或签 any：任一人同意立即通过；全员否决才否决；
// 3) 权重票 weight：同意票权重求和 ≥ 阈值才过；
//    剩余票全投同意也够不到阈值时提前判负（不必等所有人投完）。
// 条件路由（排他网关）：按规则顺序匹配第一条满足条件的分支，
// 无条件的规则是默认兜底——顺序敏感，兜底必须放最后。

export type Vote = "agree" | "reject";

export interface CountersignConfig {
  id: string;
  mode: "all" | "any" | "weight";
  signers: readonly string[];
  weight?: Readonly<Record<string, number>>; // weight 模式：signerId → 权重
  threshold?: number; // weight 模式必填
}

export type NodeStatus = "pending" | "passed" | "rejected";

export class CountersignNode {
  readonly votes = new Map<string, Vote>();
  status: NodeStatus = "pending";

  constructor(readonly cfg: CountersignConfig) {
    if (cfg.mode === "weight" && cfg.threshold === undefined)
      throw new Error("weight 模式必须提供 threshold");
  }

  vote(signerId: string, v: Vote): void {
    if (this.status !== "pending")
      throw new Error(`节点已出结果（${this.status}），不能继续投票`);
    if (!this.cfg.signers.includes(signerId))
      throw new Error(`${signerId} 不在此节点的签人名单`);
    if (this.votes.has(signerId))
      throw new Error(`${signerId} 已投过票，不允许改票`);
    this.votes.set(signerId, v);
    this.status = this.evaluate();
  }

  /** 短路评估：能出结果立即出，否则保持 pending */
  private evaluate(): NodeStatus {
    const votes = [...this.votes.values()];
    const allVoted = this.votes.size === this.cfg.signers.length;

    if (this.cfg.mode === "any") {
      if (votes.includes("agree")) return "passed"; // 任一同意立即通过
      return allVoted ? "rejected" : "pending"; // 全员否决才否
    }
    if (this.cfg.mode === "all") {
      if (votes.includes("reject")) return "rejected"; // 一票否决
      return allVoted ? "passed" : "pending";
    }

    // weight：同意票求和 ≥ 阈值 → 过；剩余全投同意也够不到 → 提前判负
    const weight = this.cfg.weight ?? {};
    const threshold = this.cfg.threshold!;
    let agreeSum = 0;
    let remaining = 0;
    for (const s of this.cfg.signers) {
      const v = this.votes.get(s);
      if (v === "agree") agreeSum += weight[s] ?? 0;
      else if (v === undefined) remaining += weight[s] ?? 0;
    }
    if (agreeSum >= threshold) return "passed";
    if (agreeSum + remaining < threshold) return "rejected";
    return "pending";
  }
}

export type Vars = Readonly<Record<string, unknown>>;

export interface RouteRule {
  to: string;
  /** 返回 true 走此分支；不传 = 默认兜底分支（必须放规则列表最后） */
  when?: (vars: Vars) => boolean;
}

/** 排他网关：返回命中的目标节点 id */
export function route(rules: readonly RouteRule[], vars: Vars): string {
  const hit = rules.find((r) => r.when?.(vars) ?? true);
  if (!hit) throw new Error("条件路由未命中且无默认分支（存在无路可走的可能）");
  return hit.to;
}

// ---------------- 验证 ----------------

console.log("=== 会签 all：一票否决 ===");
const all1 = new CountersignNode({
  id: "cs-1",
  mode: "all",
  signers: ["a", "b", "c"],
});
all1.vote("a", "agree");
all1.vote("b", "reject");
console.log("a 同意 + b 否决 →", all1.status); // rejected（c 不用投了）

console.log("\n=== 会签 all：全员同意 ===");
const all2 = new CountersignNode({
  id: "cs-2",
  mode: "all",
  signers: ["a", "b", "c"],
});
for (const s of ["a", "b", "c"]) all2.vote(s, "agree");
console.log("a/b/c 全同意 →", all2.status);

console.log("\n=== 或签 any：任一同意短路通过 ===");
const any1 = new CountersignNode({
  id: "any-1",
  mode: "any",
  signers: ["a", "b", "c"],
});
any1.vote("b", "agree");
console.log("b 一人同意 →", any1.status, "（其余人不用处理）");

console.log("\n=== 权重票：达到阈值通过 ===");
const w1 = new CountersignNode({
  id: "w-1",
  mode: "weight",
  signers: ["a", "b", "c"],
  weight: { a: 3, b: 2, c: 4 },
  threshold: 6,
});
w1.vote("a", "agree"); // 3 + 剩余 6 = 9 ≥ 6 → 还有可能
w1.vote("b", "reject"); // 3 + 4 = 7 ≥ 6 → 仍有希望
w1.vote("c", "agree"); // 3+4 = 7 ≥ 6 → 通过
console.log("3+4=7 ≥ 6 →", w1.status);

console.log("\n=== 权重票：提前判负 ===");
const w2 = new CountersignNode({
  id: "w-2",
  mode: "weight",
  signers: ["a", "b", "c"],
  weight: { a: 1, b: 1, c: 1 },
  threshold: 6,
});
w2.vote("a", "agree");
console.log("1 + 剩余 2 = 3 < 6 →", w2.status, "（不等剩余投票）");

console.log("\n=== 条件路由：顺序敏感 ===");
const rules = [
  { to: "ceo", when: (v: Vars) => (v.amount as number) > 50000 && v.urgent === true },
  { to: "director", when: (v: Vars) => (v.amount as number) > 5000 },
  { to: "manager" }, // 默认兜底
];
console.log("80000 + urgent:", route(rules, { amount: 80000, urgent: true }));
console.log("80000 不 urgent:", route(rules, { amount: 80000, urgent: false }));
console.log("3000:", route(rules, { amount: 3000 }));
