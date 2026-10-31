// 文件: examples/72-03-field-masking.ts
// ============ 列级白名单 + 脱敏引擎 + 导出二次校验 ============
// 同一条客户记录，不同角色拿到不同字段集与脱敏形态；
// 导出是比页面更严格的场景：字段必须同时满足「可读」且「允许导出」，导出请求过二次校验。

// ---------- 1. 脱敏器：纯函数集合 ----------

const maskers = {
  /** 手机：138****5678 */
  phone: (v: string) => v.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2"),
  /** 身份证：前 6 后 4，中间打码 */
  idCard: (v: string) => v.replace(/^(\d{6})\d{8}(\d{4})$/, "$1********$2"),
  /** 银行卡：只留后 4 位 */
  bankCard: (v: string) => `**** **** **** ${v.slice(-4)}`,
  /** 金额区间化：不暴露精确值，只给量级 */
  amountBucket: (v: number) => (v >= 100_000 ? "10 万以上" : v >= 10_000 ? "1-10 万" : "1 万以下"),
  /** 姓名：只留姓 */
  familyName: (v: string) => `${v[0]}*`,
};

// ---------- 2. 字段策略：白名单（能力）+ 脱敏映射（形态）+ 导出许可 ----------

interface Customer {
  name: string;
  phone: string;
  idCard: string;
  bankCard: string;
  annualAmount: number;
  level: number;
}

interface FieldPolicy {
  /** 可读字段白名单：白名单外的字段在序列化结果里直接不出现（不输出 null，防结构探测） */
  readable: readonly (keyof Customer)[];
  /** 可读但需要脱敏的字段 → 脱敏器 */
  masking: Partial<{ [K in keyof Customer]: (v: Customer[K]) => unknown }>;
  /** 允许导出的字段：页面可读 ≠ 导出可拿，默认收紧 */
  exportable: readonly (keyof Customer)[];
}

/** 序列化出口统一裁剪（真实项目里在网关/BFF 做，前端只是同策略预览） */
function sanitize(record: Customer, policy: FieldPolicy): Partial<Customer> {
  const out: Partial<Customer> = {};
  for (const field of policy.readable) {
    const mask = policy.masking[field] as ((v: unknown) => unknown) | undefined;
    out[field] = (mask ? mask(record[field]) : record[field]) as never;
  }
  return out;
}

// ---------- 3. 角色策略表 ----------

const policies: Record<string, FieldPolicy> = {
  销售: {
    readable: ["name", "phone", "level"],
    masking: { phone: maskers.phone },
    exportable: ["name", "level"], // 手机号页面可见（脱敏），导出不放行
  },
  销售主管: {
    readable: ["name", "phone", "level", "annualAmount"],
    masking: { phone: maskers.phone, annualAmount: maskers.amountBucket },
    exportable: ["name", "phone", "level", "annualAmount"],
  },
  财务: {
    readable: ["name", "bankCard", "annualAmount"],
    masking: { bankCard: maskers.bankCard },
    exportable: ["name", "bankCard", "annualAmount"], // 财务结算场景豁免导出
  },
  客服: {
    readable: ["name", "phone"],
    masking: { name: maskers.familyName, phone: maskers.phone },
    exportable: [], // 客服一律不允许导出
  },
};

const record: Customer = {
  name: "张建国",
  phone: "13812345678",
  idCard: "110101199003077812",
  bankCard: "6222020200112233445",
  annualAmount: 268_000,
  level: 1,
};

// ---------- 4. 导出链路：二次校验 ----------

/** 导出请求二次校验：客户端声明要导出的字段，必须 ⊆ 可读 ∩ 可导出 */
function exportRecords(
  rows: Customer[],
  role: string,
  requestedFields: readonly (keyof Customer)[],
): string {
  const policy = policies[role];
  const allowed = new Set(policy.exportable);
  const illegal = requestedFields.filter((f) => !policy.readable.includes(f) || !allowed.has(f));
  if (illegal.length > 0) {
    throw new Error(`导出二次校验拦截: 角色「${role}」无权导出字段 ${illegal.join(",")}`);
  }
  const header = requestedFields.join(",");
  const body = rows.map((r) => requestedFields.map((f) => String(sanitize(r, policy)[f])).join(","));
  return [header, ...body].join("\n");
}

// ---------- 5. 断言与输出 ----------

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const sales = sanitize(record, policies["销售"]);
assert(sales.phone === "138****5678", "销售看到脱敏手机");
assert(!("idCard" in sales) && !("annualAmount" in sales), "白名单外字段直接不出现");

const lead = sanitize(record, policies["销售主管"]);
assert(lead.annualAmount === ("10 万以上" as never), "主管看金额区间化");

const finance = sanitize(record, policies["财务"]);
assert(finance.bankCard === "**** **** **** 3445", "财务看银行卡后 4 位");
assert(finance.annualAmount === (268_000 as never), "财务看精确金额");
assert(!("phone" in finance), "财务看不到手机号");

const service = sanitize(record, policies["客服"]);
assert(service.name === "张*", "客服看姓氏打码");

// 导出口径：销售页面能看 phone，但导出被二次校验拦下
let exportBlocked = "";
try {
  exportRecords([record], "销售", ["name", "phone", "level"]);
} catch (e) {
  exportBlocked = (e as Error).message;
}
assert(exportBlocked.includes("phone"), "页面可读 ≠ 导出可拿");

// 销售主管导出白名单内字段：放行且内容已脱敏
const csv = exportRecords([record], "销售主管", ["name", "phone", "annualAmount"]);
assert(csv.includes("138****5678") && csv.includes("10 万以上"), "导出内容同样过 sanitize");

console.log("=== 同一条记录，四种角色四种形态 ===");
for (const role of Object.keys(policies)) {
  console.log(`${role}:`, JSON.stringify(sanitize(record, policies[role])));
}
console.log("\n=== 导出二次校验 ===");
console.log("销售申请导出 phone:", exportBlocked);
console.log("销售主管导出 CSV:\n" + csv);
console.log("✅ 白名单裁剪 / 脱敏 / 导出二次校验全部通过");
