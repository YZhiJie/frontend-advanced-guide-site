/**
 * 第 102 部分 · Element Plus 企业实战
 * el-table 二次封装：列配置 DSL → 装饰器（分页 + 虚拟滚动 + 插槽映射）
 * 核心价值：调用方只传列配置和数据源，DataTable 组件统一注入高频业务需求
 *   —— 分页、排序、虚拟滚动、空状态、加载状态、固定列、工具条
 * 运行：npx tsx examples/102-03-eltable-column-dsl.ts
 */
import assert from "node:assert";

// ---------- 1. 列配置 DSL ----------
export interface ColumnDef {
  prop?: string;
  label: string;
  width?: number | string;
  minWidth?: number | string;
  fixed?: "left" | "right";
  sortable?: boolean | "custom";
  align?: "left" | "center" | "right";
  formatter?: (row: any) => string | number;
  // slot 留空时自动用 prop 生成具名插槽名（Element Plus 推荐用具名插槽替代 formatter）
  slot?: string;
  children?: ColumnDef[]; // 多级表头
}

// ---------- 2. DataTable 装饰器 ----------
interface DataTableOptions {
  columns: ColumnDef[];
  data: any[];
  pageSize?: number;
  // 虚拟滚动策略：auto（>1000 行自动开启）/ on（强制开启）/ off（强制关闭）
  virtual?: "auto" | "on" | "off";
  emptyText?: string;
  height?: number; // 虚拟滚动必须显式设置高度
  stripe?: boolean;
  border?: boolean;
}

interface ResolvedPlan {
  tableProps: Record<string, unknown>; // 给 el-table 的最终 prop
  resolvedColumns: ColumnDef[]; // 装饰器计算后的列配置
  resolvedSlots: Map<string, ColumnDef>; // slot 名 → 列定义
  pagination: { pageSize: number; total: number; pageSizes: number[] };
  // 虚拟滚动决策结果（供开发调试）
  virtual: { enabled: boolean; reason: string };
  warnings: string[]; // 给开发者的警告（如 fixed + virtual 的冲突提示）
}

const AUTO_VIRTUAL_THRESHOLD = 1000;

function resolveDataTable(opts: DataTableOptions): ResolvedPlan {
  const warnings: string[] = [];

  // ---- 虚拟滚动决策 ----
  let virtualEnabled = false;
  let virtualReason = "";
  if (opts.virtual === "on") {
    virtualEnabled = true;
    virtualReason = "配置强制开启";
  } else if (opts.virtual === "off") {
    virtualReason = "配置强制关闭";
  } else {
    virtualEnabled = opts.data.length > AUTO_VIRTUAL_THRESHOLD;
    virtualReason = opts.data.length > AUTO_VIRTUAL_THRESHOLD
      ? `数据量 ${opts.data.length} > ${AUTO_VIRTUAL_THRESHOLD} 自动开启`
      : `数据量 ${opts.data.length} ≤ ${AUTO_VIRTUAL_THRESHOLD} 保持关闭`;
  }

  if (virtualEnabled && !opts.height) {
    warnings.push("虚拟滚动必须设置 height prop（否则 el-table 无法计算可见行）——已自动填入 600");
  }
  if (virtualEnabled && opts.columns.some((c) => c.fixed)) {
    warnings.push("固定列（fixed: 'left' | 'right'）在虚拟滚动下会导致重复渲染，大数据量场景建议移除");
  }

  // ---- 列配置：slot 自动生成 + formatter → 插槽映射 ----
  const resolvedSlots = new Map<string, ColumnDef>();
  function resolveColumn(col: ColumnDef, index: number): ColumnDef {
    const slot = col.slot ?? (col.prop ? `col-${col.prop}` : `col-group-${index}`);
    const resolved: ColumnDef = { ...col, slot };
    resolvedSlots.set(slot, resolved);
    // 把 formatter 转成 slot —— Element Plus 推荐用具名插槽替代 formatter（更灵活、支持复杂交互）
    if (col.formatter && !col.slot) {
      resolvedSlots.set(slot, { ...resolved, formatter: col.formatter });
    }
    // 递归处理多级表头
    if (col.children) resolved.children = col.children.map(resolveColumn);
    return resolved;
  }
  const resolvedColumns = opts.columns.map(resolveColumn);

  // ---- table props 自动注入 ----
  const tableProps: Record<string, unknown> = {
    "data": opts.data,
    "empty-text": opts.emptyText ?? "暂无数据",
    stripe: opts.stripe ?? true,
    border: opts.border ?? false,
  };
  if (virtualEnabled) tableProps.height = opts.height ?? 600;
  if (opts.height) tableProps.height = opts.height;

  // ---- 分页 ----
  const pageSize = opts.pageSize ?? 10;
  return {
    tableProps,
    resolvedColumns,
    resolvedSlots,
    pagination: { pageSize, total: opts.data.length, pageSizes: [10, 20, 50, 100] },
    virtual: { enabled: virtualEnabled, reason: virtualReason },
    warnings,
  };
}

// ---------- 3. 验收 ----------
const sampleData = Array.from({ length: 1500 }, (_, i) => ({
  id: i + 1,
  name: `item-${i}`,
  status: i % 3 === 0 ? "active" : i % 3 === 1 ? "pending" : "archived",
  amount: Math.round(Math.random() * 100000) / 100,
}));

const plan = resolveDataTable({
  columns: [
    { prop: "id", label: "ID", width: 80, sortable: true },
    { prop: "name", label: "名称", width: 160, minWidth: 120 },
    {
      prop: "status",
      label: "状态",
      width: 100,
      formatter: (r: any) =>
        ({ active: "🟢 启用", pending: "🟡 待审", archived: "🔴 归档" }[r.status] ?? "未知"),
    },
    { prop: "amount", label: "金额", width: 120, align: "right" },
    { label: "操作", width: 180, fixed: "right" },
  ],
  data: sampleData,
  pageSize: 20,
  // virtual: "auto" 省略即默认
});

assert.ok(plan.virtual.enabled, "1500 行 → 自动开启虚拟滚动");
assert.ok(plan.tableProps.height, "虚拟滚动自动填入 height");
assert.equal(plan.pagination.pageSize, 20);
assert.equal(plan.pagination.total, 1500);

// slot 自动生成
assert.equal(plan.resolvedColumns[0].slot, "col-id");
assert.equal(plan.resolvedColumns[1].slot, "col-name");
assert.equal(plan.resolvedColumns[2].slot, "col-status");

// fixed: 'right' + virtual → 警告
assert.ok(plan.warnings.some((w) => w.includes("固定列")));

console.log("[A] 1500 行数据：自动开启虚拟滚动 + height 注入 ✓");
console.log("[B] 列配置 → 插槽自动映射：col-id / col-name / col-status ✓");
console.log("[C] 固定列 + 虚拟滚动冲突：已给出警告:", plan.warnings.find((w) => w.includes("固定列")));

// 场景：小数据量强制关闭
const smallPlan = resolveDataTable({ columns: [], data: Array.from({ length: 50 }, (_, i) => ({ id: i })), virtual: "off" });
assert.ok(!smallPlan.virtual.enabled);
assert.ok(!smallPlan.tableProps.height, "关闭虚拟滚动不应有 height");
console.log("[D] 强制关闭虚拟滚动 → ✓");

// 场景：无 fixed，无 height，自动开启 → 警告自动填入 height
const autoPlan = resolveDataTable({ columns: [{ label: "X" }], data: Array.from({ length: 2000 }, (_, i) => ({ id: i })) });
assert.ok(autoPlan.virtual.enabled);
assert.ok(autoPlan.warnings.some((w) => w.includes("必须设置 height")));
console.log("[E] 虚拟滚动缺 height → 自动填入 600 + 给开发者警告 ✓");

console.log("✅ 102-03 全部断言通过");
