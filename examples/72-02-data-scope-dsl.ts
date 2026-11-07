// 文件: examples/72-02-data-scope-dsl.ts
// ============ 行级数据范围 DSL 求值器 ============
// DSL 解析 → 编译期越权校验 → 条件组合求值 → 对模拟客户数据集过滤。
// 三条铁律：封闭操作符集（未知即拒绝）、dept_in 不得超出用户可见集合（越权组合编译期拒绝）、前后端跑同一份 DSL。

// ---------- 1. DSL 定义（可 JSON 序列化，随策略下发） ----------

type Rule =
  | { op: "and" | "or"; args: Rule[] }
  | { op: "not"; arg: Rule }
  | { op: "dept_in"; value: string[] } // 行归属部门 ∈ 指定集合
  | { op: "level_gte" | "level_lte"; value: number } // 客户分层等级
  | { op: "tag_has"; value: string } // 行业/客群标签
  | { op: "owner_eq"; value: "$self" }; // 归属人 = 当前用户（$self 是唯一的变量位）

interface Ctx {
  selfId: string;
  visibleDepts: ReadonlySet<string>; // 72-01 推导出的可见部门集合，dept_in 的合法值域
}

interface CustomerRow {
  id: string;
  name: string;
  deptId: string;
  level: number; // 要客分层：1 战略 / 2 重点 / 3 普通 / 4 长尾
  tags: string[];
  ownerId: string;
}

// ---------- 2. 编译：校验 + 生成谓词 ----------

type Predicate = (row: CustomerRow) => boolean;

function compile(rule: Rule, ctx: Ctx): Predicate {
  switch (rule.op) {
    case "and":
      return (row) => rule.args.every((r) => compile(r, ctx)(row));
    case "or":
      return (row) => rule.args.some((r) => compile(r, ctx)(row));
    case "not":
      return (row) => !compile(rule.arg, ctx)(row);
    case "dept_in": {
      // 越权组合拦截：声明的部门必须 ⊆ 用户可见集合，否则这条规则本身就在放大权限
      const illegal = rule.value.filter((d) => !ctx.visibleDepts.has(d));
      if (illegal.length > 0) {
        throw new Error(`越权组合被拒绝: dept_in 引用了可见范围外的部门 ${illegal.join(",")}`);
      }
      const allow = new Set(rule.value);
      return (row) => allow.has(row.deptId);
    }
    case "level_gte":
      return (row) => row.level <= rule.value; // level 数值越小层级越高，1 是战略要客
    case "level_lte":
      return (row) => row.level >= rule.value;
    case "tag_has":
      return (row) => row.tags.includes(rule.value);
    case "owner_eq":
      return (row) => row.ownerId === ctx.selfId;
    default:
      // 封闭操作符集：看不懂的规则一律当作不存在，走默认拒绝（与 37 册同一原则）
      throw new Error(`未知操作符: ${(rule as { op: string }).op}`);
  }
}

// ---------- 3. 模拟数据集 ----------

const rows: CustomerRow[] = [
  { id: "c1", name: "国投集团", deptId: "d111", level: 1, tags: ["央企", "能源"], ownerId: "u3" },
  { id: "c2", name: "南岭电网", deptId: "d112", level: 2, tags: ["央企", "电力"], ownerId: "u9" },
  { id: "c3", name: "沪上银行", deptId: "d111", level: 2, tags: ["金融"], ownerId: "u3" },
  { id: "c4", name: "鹏城制造", deptId: "d122", level: 3, tags: ["制造"], ownerId: "u8" },
  { id: "c5", name: "街角便利", deptId: "d121", level: 4, tags: ["零售"], ownerId: "u7" },
];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const run = (rule: Rule, ctx: Ctx) => rows.filter(compile(rule, ctx)).map((r) => r.id);

// ---------- 4. 求值演示 ----------

// 张经理：大客户一部（d111 单部门可见），且只看重点及以上要客（level ≤ 2）
const zhangCtx: Ctx = { selfId: "u3", visibleDepts: new Set(["d111"]) };
const zhangRule: Rule = {
  op: "and",
  args: [{ op: "dept_in", value: ["d111"] }, { op: "level_gte", value: 2 }],
};
assert(run(zhangRule, zhangCtx).join() === "c1,c3", "部门 + 要客层级组合过滤");

// 李总经理：事业部三部门可见；规则 = 事业部范围 且（战略要客 或 归我直管）
const liCtx: Ctx = { selfId: "u2", visibleDepts: new Set(["d11", "d111", "d112"]) };
const liRule: Rule = {
  op: "and",
  args: [
    { op: "dept_in", value: ["d111", "d112"] },
    { op: "or", args: [{ op: "level_gte", value: 1 }, { op: "owner_eq", value: "$self" }] },
  ],
};
assert(run(liRule, liCtx).join() === "c1", "or/not 嵌套组合");

// not：排除长尾客户
const notRule: Rule = { op: "and", args: [{ op: "dept_in", value: ["d111"] }, { op: "not", arg: { op: "level_lte", value: 4 } }] };
assert(run(notRule, zhangCtx).join() === "c1,c3", "not 排除长尾");

// tag：只看央企客群
const tagRule: Rule = { op: "and", args: [{ op: "dept_in", value: ["d111", "d112"] }, { op: "tag_has", value: "央企" }] };
assert(run(tagRule, liCtx).join() === "c1,c2", "标签条件");

// ---------- 5. 越权与非法规则：编译期拒绝 ----------

let rejected = "";
try {
  // 张经理把 dept_in 写成 d112（不在他的可见集合里）——规则本身越权
  compile({ op: "dept_in", value: ["d112"] }, zhangCtx);
} catch (e) {
  rejected = (e as Error).message;
}
assert(rejected.includes("越权组合被拒绝"), "dept_in 超出可见集合必须编译期拒绝");

let unknownRejected = "";
try {
  compile({ op: "raw_sql", value: "1=1" } as unknown as Rule, zhangCtx);
} catch (e) {
  unknownRejected = (e as Error).message;
}
assert(unknownRejected.includes("未知操作符"), "封闭操作符集，未知即拒绝");

console.log("=== 行级 DSL 求值结果 ===");
console.log("张经理（d111 + 重点以上要客）:", run(zhangRule, zhangCtx).join(", "));
console.log("李总经理（事业部 + 战略或直管）:", run(liRule, liCtx).join(", "));
console.log("越权组合拦截:", rejected);
console.log("未知操作符拦截:", unknownRejected);
console.log("✅ DSL 解析 / 条件组合 / 越权拒绝全部通过");
