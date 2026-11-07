// 文件: examples/42-04-flow-definition.ts
// ============ 流程定义：BPMN 风格 JSON 的校验与模拟 ============
// 审批引擎的核心资产不是代码，是「流程定义」——一份可存储、可版本化、可校验的 JSON。
// 节点类型：start / userTask / exclusiveGateway（排他网关）/ parallelGateway（并行网关）/ end
// 装载期校验（与第 38 册 Schema 自检同思想）：错误在发布前暴露，而不是运行到一半无路可走。
// 校验规则：
//   ① id 不重复；② 恰好一个 start；③ start 可达全部节点（无孤儿）；
//   ④ 非 end 节点必须有后继；⑤ end 不能有出边；
//   ⑥ 排他网关必须恰好一个默认分支（无条件分支）——否则可能无路可走。

export type NodeKind =
  | "start"
  | "userTask"
  | "exclusiveGateway"
  | "parallelGateway"
  | "end";

export type Vars = Readonly<Record<string, unknown>>;

export interface FlowNode {
  id: string;
  kind: NodeKind;
  name?: string;
  assignee?: string; // userTask 的处理人（真实引擎是候选人表达式）
  next?: readonly string[];
  /** 排他网关分支条件：key 为后继节点 id，返回 true 走该分支；无条件的后继是默认分支 */
  branchConditions?: Readonly<Record<string, (vars: Vars) => boolean>>;
}

export function validateFlow(
  nodes: readonly FlowNode[],
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const byId = new Map<string, FlowNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) errors.push(`节点 id 重复：${n.id}`);
    byId.set(n.id, n);
  }
  if (errors.length > 0) return { ok: false, errors };

  const starts = nodes.filter((n) => n.kind === "start");
  if (starts.length !== 1)
    errors.push(`start 节点必须恰好 1 个，实际 ${starts.length}`);

  // start 可达性（BFS）
  if (starts.length === 1) {
    const seen = new Set<string>([starts[0].id]);
    const queue = [starts[0]];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nxt of cur.next ?? []) {
        const target = byId.get(nxt);
        if (!target) {
          errors.push(`节点 ${cur.id} 指向不存在的 ${nxt}`);
          continue;
        }
        if (!seen.has(nxt)) {
          seen.add(nxt);
          queue.push(target);
        }
      }
    }
    for (const n of nodes)
      if (!seen.has(n.id)) errors.push(`孤儿节点（start 不可达）：${n.id}`);
  }

  for (const n of nodes) {
    if (n.kind === "end") {
      if (n.next?.length) errors.push(`end 节点 ${n.id} 不能有出边`);
      continue;
    }
    if (!n.next?.length) errors.push(`节点 ${n.id}（${n.kind}）没有后继`);
    if (n.kind === "exclusiveGateway" && n.next) {
      const conds = n.branchConditions ?? {};
      const defaults = n.next.filter((nxt) => !conds[nxt]).length;
      if (defaults === 0)
        errors.push(`排他网关 ${n.id} 缺少默认分支（所有分支都带条件）`);
      if (defaults > 1)
        errors.push(`排他网关 ${n.id} 有 ${defaults} 个默认分支，只能有一个`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 模拟执行：排他网关取第一条满足条件的分支，默认分支兜底（并行网关教学取第一后继，join 语义见正文） */
export function simulate(
  nodes: readonly FlowNode[],
  vars: Vars,
  maxSteps = 100,
): { path: string[]; error?: string } {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const start = nodes.find((n) => n.kind === "start");
  if (!start) return { path: [], error: "无 start 节点" };
  const path: string[] = [];
  let cur: FlowNode | undefined = start;
  let steps = 0;
  while (cur && cur.kind !== "end") {
    path.push(cur.id);
    if (++steps > maxSteps) return { path, error: "超过最大步数（疑似死循环）" };
    const nexts = cur.next ?? [];
    if (nexts.length === 0) return { path, error: `节点 ${cur.id} 无后继` };
    if (cur.kind === "exclusiveGateway") {
      const conds = cur.branchConditions ?? {};
      let picked = nexts.find((n) => conds[n]?.(vars));
      if (!picked) picked = nexts.find((n) => !conds[n]);
      if (!picked) return { path, error: `排他网关 ${cur.id} 无分支命中` };
      cur = byId.get(picked);
    } else {
      cur = byId.get(nexts[0]);
    }
  }
  if (cur) path.push(cur.id);
  return { path };
}

// ---------------- 验证 ----------------

console.log("=== 合法流程：定义 → 校验 → 按变量模拟 ===");
const flow: FlowNode[] = [
  { id: "s", kind: "start", next: ["fill"] },
  { id: "fill", kind: "userTask", name: "填写报销单", assignee: "${starter}", next: ["gw-amount"] },
  {
    id: "gw-amount",
    kind: "exclusiveGateway",
    name: "金额分流",
    next: ["director", "manager"],
    branchConditions: {
      director: (v) => (v.amount as number) > 5000,
      // manager 为默认分支（无条件）
    },
  },
  { id: "director", kind: "userTask", name: "总监审批", assignee: "d001", next: ["e"] },
  { id: "manager", kind: "userTask", name: "经理审批", assignee: "m001", next: ["e"] },
  { id: "e", kind: "end" },
];
const v1 = validateFlow(flow);
console.log("校验:", v1.ok, v1.errors);
console.log("报销 8000:", simulate(flow, { amount: 8000 }).path.join(" → "));
console.log("报销 3000:", simulate(flow, { amount: 3000 }).path.join(" → "));

console.log("\n=== 坏流程：校验器一次报出全部问题 ===");
const bad: FlowNode[] = [
  { id: "s1", kind: "start", next: ["t1"] },
  { id: "s2", kind: "start", next: ["t2"] }, // 两个 start
  { id: "t1", kind: "userTask", assignee: "a", next: ["gw"] },
  { id: "t2", kind: "userTask", assignee: "b" }, // 无后继
  {
    id: "gw",
    kind: "exclusiveGateway",
    next: ["t1", "t3"],
    branchConditions: { t1: () => true, t3: () => true }, // 无默认分支
  },
  { id: "t3", kind: "userTask", assignee: "c", next: ["e"] },
  { id: "e", kind: "end", next: ["t1"] }, // end 有出边
  { id: "orphan", kind: "userTask", assignee: "d", next: ["e"] }, // 孤儿
];
const v2 = validateFlow(bad);
console.log("校验:", v2.ok);
for (const e of v2.errors) console.log("  ✗", e);
