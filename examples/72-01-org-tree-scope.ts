// 文件: examples/72-01-org-tree-scope.ts
// ============ 组织树建模与四种可见范围推导 ============
// 部门树（物化路径）+ 岗位/一人多岗 + 四种数据范围（本级/本级及下级/指定范围/全部）
// 一人多岗时可见集合取并集，输出不同角色的可见部门清单。

// ---------- 1. 组织树：邻接表输入 → 物化路径 ----------

interface DeptRow {
  id: string;
  name: string;
  parentId: string | null;
}

interface DeptNode extends DeptRow {
  /** 物化路径：形如 /d1/d11/d111/，含自身；前缀匹配即可取子孙 */
  path: string;
}

/** 由扁平部门列表构建带物化路径的节点表（真实项目里 path 由后端主数据下发） */
function buildDeptMap(rows: DeptRow[]): Map<string, DeptNode> {
  const map = new Map<string, DeptNode>();
  for (const r of rows) map.set(r.id, { ...r, path: "" });
  const fill = (id: string): string => {
    const node = map.get(id)!;
    if (node.path) return node.path;
    node.path = node.parentId ? `${fill(node.parentId)}${id}/` : `/${id}/`;
    return node.path;
  };
  for (const r of rows) fill(r.id);
  return map;
}

/** 子孙集：物化路径前缀匹配，O(N) 全表扫；大树可换成闭包表或预计算索引 */
function descendants(map: Map<string, DeptNode>, deptId: string): string[] {
  const prefix = map.get(deptId)!.path;
  return [...map.values()].filter((n) => n.path.startsWith(prefix)).map((n) => n.id);
}

/** 祖先链：把物化路径切开就是，零成本 */
function ancestors(map: Map<string, DeptNode>, deptId: string): string[] {
  return map.get(deptId)!.path.split("/").filter(Boolean).slice(0, -1);
}

// ---------- 2. 岗位与数据范围 ----------

type DataScope = "all" | "dept_and_children" | "dept" | "custom";

interface Position {
  title: string;
  deptId: string; // 岗位挂靠的部门（虚拟团队也建模为一个挂靠节点）
  scope: DataScope;
  customDeptIds?: string[]; // scope = custom 时的指定范围
}

interface Employee {
  id: string;
  name: string;
  positions: Position[]; // 一人多岗：多个岗位各自携带数据范围
}

/** 单岗位可见集合 */
function scopeOf(map: Map<string, DeptNode>, pos: Position): Set<string> {
  switch (pos.scope) {
    case "all":
      return new Set(map.keys());
    case "dept_and_children":
      return new Set(descendants(map, pos.deptId));
    case "dept":
      return new Set([pos.deptId]);
    case "custom":
      return new Set(pos.customDeptIds ?? []);
  }
}

/** 一人多岗：可见集合 = 各岗位范围并集（与 35 册「多角色取最大」同一思想，但岗位维度是集合并集而非取最宽档） */
function visibleDeptIds(map: Map<string, DeptNode>, emp: Employee): Set<string> {
  const out = new Set<string>();
  for (const pos of emp.positions) {
    for (const id of scopeOf(map, pos)) out.add(id);
  }
  return out;
}

// ---------- 3. 模拟主数据 ----------

const deptRows: DeptRow[] = [
  { id: "d1", name: "集团总部", parentId: null },
  { id: "d11", name: "战略客户事业部", parentId: "d1" },
  { id: "d111", name: "大客户一部", parentId: "d11" },
  { id: "d112", name: "大客户二部", parentId: "d11" },
  { id: "d12", name: "区域运营中心", parentId: "d1" },
  { id: "d121", name: "华东区", parentId: "d12" },
  { id: "d122", name: "华南区", parentId: "d12" },
  { id: "d13", name: "职能平台", parentId: "d1" },
  { id: "d131", name: "财务部", parentId: "d13" },
];

const employees: Employee[] = [
  { id: "u1", name: "王董事长", positions: [{ title: "董事长", deptId: "d1", scope: "all" }] },
  { id: "u2", name: "李总经理", positions: [{ title: "事业部总经理", deptId: "d11", scope: "dept_and_children" }] },
  { id: "u3", name: "张经理", positions: [{ title: "大客户一部经理", deptId: "d111", scope: "dept" }] },
  {
    id: "u4",
    name: "陈 HRBP",
    positions: [
      { title: "华东区 HRBP", deptId: "d121", scope: "dept" },
      { title: "校招项目组成员", deptId: "d13", scope: "custom", customDeptIds: ["d122", "d131"] },
    ],
  },
];

// ---------- 4. 断言与输出 ----------

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const map = buildDeptMap(deptRows);
const nameOf = (id: string) => map.get(id)!.name;
const sorted = (s: Set<string>) => [...s].sort();

assert(map.get("d111")!.path === "/d1/d11/d111/", "物化路径生成");
assert(descendants(map, "d11").sort().join() === "d11,d111,d112", "子孙集前缀匹配");
assert(ancestors(map, "d111").join() === "d1,d11", "祖先链来自路径切分");

const dong = visibleDeptIds(map, employees[0]);
assert(dong.size === deptRows.length, "all 看到全部部门");

const li = visibleDeptIds(map, employees[1]);
assert(sorted(li).join() === "d11,d111,d112", "本级及下级");

const zhang = visibleDeptIds(map, employees[2]);
assert(sorted(zhang).join() === "d111", "仅本级");

const chen = visibleDeptIds(map, employees[3]);
assert(sorted(chen).join() === "d121,d122,d131", "一人多岗取并集：本部门 ∪ 指定范围");

console.log("=== 各角色可见部门清单 ===");
for (const emp of employees) {
  const names = sorted(visibleDeptIds(map, emp)).map(nameOf);
  console.log(`${emp.name}（${emp.positions.map((p) => p.title).join(" + ")}）`);
  console.log(`  可见 ${names.length} 个部门：${names.join("、")}`);
}
console.log("✅ 组织树建模 / 四种范围推导 / 一人多岗并集全部通过");
