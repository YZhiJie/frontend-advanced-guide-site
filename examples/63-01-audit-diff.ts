/** 63-01-audit-diff.ts —— 审计字段级 diff 生成器：变更前后值 + 数组变更 + 脱敏字段剔除 + 审计编号 */

type Json = Record<string, unknown>;
interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
  kind: "modified" | "added" | "removed";
}

// 脱敏字段清单：审计日志里绝不能落这些字段的原始值（见 47 册）
const SENSITIVE_FIELDS = new Set(["password", "idCard", "bankCard", "token", "secret"]);

// 字段级 diff：只记录"变化了什么",不记全量快照（存储与可读性双重考虑）
function diffObject(before: Json, after: Json, prefix = ""): FieldChange[] {
  const changes: FieldChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (SENSITIVE_FIELDS.has(k)) continue; // 脱敏字段直接剔除,不落"***"——不落盘才是真的脱敏
    const b = before[k];
    const a = after[k];
    if (!(k in before)) {
      changes.push({ field: path, before: undefined, after: a, kind: "added" });
    } else if (!(k in after)) {
      changes.push({ field: path, before: b, after: undefined, kind: "removed" });
    } else if (isPlain(b) && isPlain(a)) {
      changes.push(...diffObject(b as Json, a as Json, path)); // 嵌套对象递归到叶子
    } else if (Array.isArray(b) && Array.isArray(a)) {
      // 数组按"元素集合"对比：记新增与移除的项,不记顺序变化（业务数组多是无序集合）
      const bSet = new Set(b.map(stable));
      const aSet = new Set(a.map(stable));
      const added = a.filter((x) => !bSet.has(stable(x)));
      const removed = b.filter((x) => !aSet.has(stable(x)));
      if (added.length || removed.length) {
        changes.push({ field: path, before: removed, after: added, kind: "modified" });
      }
    } else if (!Object.is(b, a)) {
      changes.push({ field: path, before: b, after: a, kind: "modified" });
    }
  }
  return changes;
}
const isPlain = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const stable = (v: unknown): string => JSON.stringify(v ?? null);

// 审计事件：五要素 WHO/WHEN/WHAT/HOW/RESULT + 追踪链
interface AuditEvent {
  auditId: string; // 审计编号：幂等键,重试不重复落
  actor: string; // WHO
  at: number; // WHEN（服务端校准后的时间,不用客户端原始时钟,见 32 册）
  target: { type: string; id: string }; // WHAT（对什么对象）
  action: string; // HOW（做了什么动作）
  changes: FieldChange[]; // 变化明细
  result: "success" | "failure"; // RESULT
  traceId: string; // 贯穿请求链路的追踪 ID（59 册）
}
function buildAuditEvent(
  input: Omit<AuditEvent, "auditId" | "changes"> & { before: Json; after: Json },
): AuditEvent {
  const { before, after, ...rest } = input;
  return {
    auditId: `${input.actor}-${input.at}-${hashStr(input.traceId + input.action)}`,
    changes: diffObject(before, after),
    ...rest,
  };
}
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---- 断言 ----
// 字段级 diff
const changes = diffObject(
  { name: "张三", role: "viewer", dept: { name: "技术部", level: 2 }, tags: ["a", "b"] },
  { name: "张三", role: "admin", dept: { name: "技术部", level: 3 }, tags: ["b", "c"] },
);
console.assert(changes.length === 3, "只记变化字段：role + dept.level + tags");
console.assert(
  changes.some((c) => c.field === "role" && c.before === "viewer" && c.after === "admin"),
  "标量变更记录前后值",
);
console.assert(
  changes.some((c) => c.field === "dept.level" && c.before === 2 && c.after === 3),
  "嵌套对象递归到叶子路径",
);
const tagChange = changes.find((c) => c.field === "tags")!;
console.assert(
  JSON.stringify(tagChange.before) === '["a"]' && JSON.stringify(tagChange.after) === '["c"]',
  "数组记新增/移除项,不记顺序",
);

// 新增与删除键
const addDel = diffObject({ a: 1, b: 2 }, { a: 1, c: 3 });
console.assert(
  addDel.some((c) => c.kind === "removed" && c.field === "b") &&
    addDel.some((c) => c.kind === "added" && c.field === "c"),
  "键的新增与删除分别标记",
);

// 脱敏字段不落盘
const masked = diffObject(
  { password: "old-secret", name: "a" },
  { password: "new-secret", name: "b" },
);
console.assert(
  masked.length === 1 && masked[0].field === "name",
  "敏感字段整体剔除,不落前后值",
);

// 审计事件构建 + 幂等编号
const ev1 = buildAuditEvent({
  actor: "u-100", at: 1730000000000, target: { type: "role", id: "r-1" },
  action: "role.grant", before: { role: "viewer" }, after: { role: "admin" },
  result: "success", traceId: "trace-abc",
});
const ev2 = buildAuditEvent({
  actor: "u-100", at: 1730000000000, target: { type: "role", id: "r-1" },
  action: "role.grant", before: { role: "viewer" }, after: { role: "admin" },
  result: "success", traceId: "trace-abc",
});
console.assert(ev1.auditId === ev2.auditId, "相同事件生成相同审计编号（幂等）");
console.assert(ev1.changes.length === 1 && ev1.changes[0].after === "admin", "事件携带变化明细");

console.log("✅ 字段 diff / 数组变更 / 脱敏剔除 / 幂等审计编号全部通过");
