/** 63-02-audit-query.ts —— 审计日志查询端：多条件筛选组合 + diff 视图渲染模型 + 游标翻页 */

interface AuditRow {
  auditId: string;
  actor: string;
  at: number;
  targetType: string;
  targetId: string;
  action: string;
  result: "success" | "failure";
  changes: { field: string; before: unknown; after: unknown; kind: string }[];
}

interface AuditFilter {
  actor?: string;
  targetType?: string;
  actionPrefix?: string; // "role.*" 匹配 role.grant/role.revoke
  result?: "success" | "failure";
  from?: number; // 时间窗 [from, to)
  to?: number;
  keyword?: string; // 命中 targetId 或 changes 的 field
}

// 组合筛选：全部条件是 AND 关系;空条件不参与
function filterAudit(rows: AuditRow[], f: AuditFilter): AuditRow[] {
  return rows.filter((r) => {
    if (f.actor && r.actor !== f.actor) return false;
    if (f.targetType && r.targetType !== f.targetType) return false;
    if (f.actionPrefix) {
      const prefix = f.actionPrefix.replace(/\*$/, "");
      if (!r.action.startsWith(prefix)) return false;
    }
    if (f.result && r.result !== f.result) return false;
    if (f.from !== undefined && r.at < f.from) return false;
    if (f.to !== undefined && r.at >= f.to) return false;
    if (f.keyword) {
      const kw = f.keyword.toLowerCase();
      const hitTarget = r.targetId.toLowerCase().includes(kw);
      const hitField = r.changes.some((c) => c.field.toLowerCase().includes(kw));
      if (!hitTarget && !hitField) return false;
    }
    return true;
  });
}

// diff 视图渲染模型：把 changes 转成"人类可读"的展示行
// 三种展示形态：modified=前后对照 added=纯新增 removed=纯删除
interface DiffViewRow {
  field: string;
  kind: string;
  text: string;
  tone: "neutral" | "green" | "red";
}
function toDiffView(r: AuditRow, fmt: (v: unknown) => string = String): DiffViewRow[] {
  return r.changes.map((c) => {
    if (c.kind === "added")
      return { field: c.field, kind: c.kind, text: `新增 ${fmt(c.after)}`, tone: "green" };
    if (c.kind === "removed")
      return { field: c.field, kind: c.kind, text: `删除 ${fmt(c.before)}`, tone: "red" };
    return {
      field: c.field,
      kind: c.kind,
      text: `${fmt(c.before)} → ${fmt(c.after)}`,
      tone: "neutral",
    };
  });
}

// 游标翻页：审计日志按 at 倒序,游标=当前页最旧一条的 at（62 册同型）
function pageByCursor(rows: AuditRow[], cursor: number | null, size: number) {
  const sorted = [...rows].sort((a, b) => b.at - a.at);
  const rest = cursor === null ? sorted : sorted.filter((r) => r.at < cursor);
  const page = rest.slice(0, size);
  return {
    page,
    nextCursor: page.length > 0 ? page[page.length - 1].at : null,
    hasMore: rest.length > size,
  };
}

// ---- 断言 ----
const rows: AuditRow[] = [
  { auditId: "a1", actor: "admin", at: 500, targetType: "role", targetId: "r-1", action: "role.grant", result: "success", changes: [{ field: "role", before: "viewer", after: "admin", kind: "modified" }] },
  { auditId: "a2", actor: "admin", at: 400, targetType: "user", targetId: "u-9", action: "user.disable", result: "success", changes: [{ field: "status", before: "active", after: "disabled", kind: "modified" }] },
  { auditId: "a3", actor: "ops", at: 300, targetType: "role", targetId: "r-2", action: "role.revoke", result: "failure", changes: [] },
  { auditId: "a4", actor: "ops", at: 200, targetType: "user", targetId: "u-1", action: "user.create", result: "success", changes: [{ field: "name", before: undefined, after: "李四", kind: "added" }] },
];

// 组合筛选 AND
console.assert(
  filterAudit(rows, { actor: "admin", targetType: "role" }).length === 1,
  "actor + targetType 双条件交集",
);
console.assert(
  filterAudit(rows, { actionPrefix: "role.*" }).map((r) => r.auditId).join() === "a1,a3",
  "action 前缀通配",
);
console.assert(
  filterAudit(rows, { result: "failure" })[0].auditId === "a3",
  "按结果筛选失败操作",
);
console.assert(
  filterAudit(rows, { from: 250, to: 450 }).map((r) => r.auditId).join() === "a2,a3",
  "时间窗 [from,to) 左闭右开",
);
console.assert(
  filterAudit(rows, { keyword: "status" })[0].auditId === "a2",
  "关键词命中变化字段",
);

// diff 视图
const view = toDiffView(rows[0]);
console.assert(
  view[0].text === "viewer → admin" && view[0].tone === "neutral",
  "modified 前后对照",
);
const addView = toDiffView(rows[3]);
console.assert(
  addView[0].text === "新增 李四" && addView[0].tone === "green",
  "added 绿色展示",
);

// 游标翻页
const p1 = pageByCursor(rows, null, 2);
console.assert(p1.page.map((r) => r.auditId).join() === "a1,a2" && p1.nextCursor === 400 && p1.hasMore, "第一页倒序取 2 条");
const p2 = pageByCursor(rows, p1.nextCursor, 2);
console.assert(p2.page.map((r) => r.auditId).join() === "a3,a4" && !p2.hasMore, "第二页接续无重复");
console.assert(
  new Set([...p1.page, ...p2.page].map((r) => r.auditId)).size === 4,
  "翻页全程无重复无遗漏",
);

console.log("✅ 组合筛选 / diff 视图 / 游标翻页全部通过");
