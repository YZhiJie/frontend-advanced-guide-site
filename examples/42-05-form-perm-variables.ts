// 文件: examples/42-05-form-perm-variables.ts
// ============ 节点表单权限与流程变量 ============
// 审批表单和普通表单（第 38 册）的差别：权限跟着「节点」走——
// 同一张表单，发起节点全可编辑，审批节点只能看（read）或改个别字段（edit）。
// 四级字段权限：hidden（不可见，提交体裁剪）/ read（只读）/ edit（可改）/ required（必填）。
// 未授权字段默认 hidden（默认拒绝原则，与第 37 册一致）。
// 流程变量：发起时注入 + 节点处理中写入 → 驱动后续条件路由（与 42-04 网关配合）。
// 每次写入留痕（谁、在哪个节点、改成什么），审计时能回答「变量是谁改的」。

export type FieldPerm = "hidden" | "read" | "edit" | "required";

export interface NodeFormPerm {
  [fieldKey: string]: FieldPerm;
}

export interface FieldDef {
  key: string;
  label: string;
}

export interface ResolveResult {
  visible: Record<string, unknown>; // 提交体：hidden 字段被裁剪（不出 key，而非置 null）
  editable: string[];
  violations: string[]; // required 字段缺失
}

export function resolveNodeForm(
  fields: readonly FieldDef[],
  perm: NodeFormPerm,
  values: Readonly<Record<string, unknown>>,
): ResolveResult {
  const visible: Record<string, unknown> = {};
  const editable: string[] = [];
  const violations: string[] = [];
  for (const f of fields) {
    const p: FieldPerm = perm[f.key] ?? "hidden"; // 默认拒绝
    if (p === "hidden") continue;
    visible[f.key] = values[f.key];
    if (p === "edit" || p === "required") editable.push(f.key);
    if (
      p === "required" &&
      (values[f.key] === undefined ||
        values[f.key] === null ||
        values[f.key] === "")
    )
      violations.push(f.key);
  }
  return { visible, editable, violations };
}

export interface ChangeLogEntry {
  seq: number;
  key: string;
  value: unknown;
  by: string;
  node: string;
}

export class ProcessVariables {
  private vars: Record<string, unknown> = {};
  readonly changeLog: ChangeLogEntry[] = [];

  set(key: string, value: unknown, by: string, node: string): void {
    this.vars[key] = value;
    this.changeLog.push({
      seq: this.changeLog.length + 1,
      key,
      value,
      by,
      node,
    });
  }

  get(key: string): unknown {
    return this.vars[key];
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return { ...this.vars };
  }
}

// ---------------- 验证 ----------------

const fields: FieldDef[] = [
  { key: "title", label: "事由" },
  { key: "days", label: "请假天数" },
  { key: "amount", label: "预估费用" },
  { key: "salary", label: "薪资等级" }, // 敏感字段
];

const perms: Record<string, NodeFormPerm> = {
  starter: {
    title: "required",
    days: "required",
    amount: "edit",
    salary: "hidden",
  },
  manager: { title: "read", days: "read", amount: "read", salary: "hidden" },
  director: { title: "read", days: "edit", amount: "edit", salary: "hidden" },
};

const values = { title: "年假", days: 5, amount: 3000, salary: "P7" };

console.log("=== 发起节点：可编辑 + required 校验 ===");
console.log(
  resolveNodeForm(fields, perms.starter, { title: "", days: 5, amount: 3000 }),
);

console.log("\n=== 审批节点：全只读（read 不进 editable，值照常带出） ===");
console.log(resolveNodeForm(fields, perms.manager, values));

console.log("\n=== 总监节点：可改天数与费用，薪资对所有人 hidden ===");
const r = resolveNodeForm(fields, perms.director, {
  ...values,
  days: 3,
  amount: 2600,
});
console.log("提交体:", r.visible); // salary 不出 key
console.log("可编辑:", r.editable);

console.log("\n=== 流程变量：写入留痕 + 驱动路由 ===");
const vars = new ProcessVariables();
vars.set("days", 5, "e1001", "starter");
vars.set("urgent", true, "m001", "manager"); // 审批中改变量 → 影响后续路由
console.log("快照:", vars.snapshot());
for (const c of vars.changeLog)
  console.log(`#${c.seq} ${c.node} 节点 ${c.by} 设置 ${c.key} = ${c.value}`);

type Route = { to: string; when?: (v: Record<string, unknown>) => boolean };

const rules: Route[] = [
  { to: "director", when: (v) => (v.days as number) > 3 || v.urgent === true },
  { to: "manager" }, // 默认兜底
];
const hit = rules.find((r) => r.when?.(vars.snapshot()) ?? true)!;
console.log("路由结果（days=5 → 总监）:", hit.to);
