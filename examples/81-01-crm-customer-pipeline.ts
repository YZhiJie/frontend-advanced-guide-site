// 文件: examples/81-01-crm-customer-pipeline.ts
// ============ AI 外贸获客与 CRM 全链路 ============
// 对应 JD「AI 外贸获客平台：产品分析、ICP 分析、客户搜索、客户筛选、联系方式获取、CRM」。
// ICP 评分 → 多维筛选 → 联系方式补全 → CRM 阶段推进，硬断言直跑。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. ICP 理想客户画像与评分 ----------------

export interface ICPProfile {
  /** 目标行业 */
  industries: string[];
  /** 目标公司规模（员工数区间） */
  employeeRange: [number, number];
  /** 目标地区 */
  regions: string[];
  /** 年营收下限（万美元） */
  minRevenue: number;
}

export interface Customer {
  id: string;
  name: string;
  industry: string;
  employees: number;
  region: string;
  revenue: number; // 万美元
  hasContact: boolean;
  stage: "lead" | "prospect" | "qualified" | "won" | "lost";
}

/**
 * ICP 匹配度评分（0~100）：四维各 25 分，命中得满分，部分命中按比例。
 * 这是 AI 获客的核心——从公海海量客户里筛出"最像理想客户"的那批。
 */
export function icpScore(customer: Customer, icp: ICPProfile): number {
  let score = 0;
  // 行业（25）
  score += icp.industries.includes(customer.industry) ? 25 : 0;
  // 规模（25）：在区间内满分，区间外按距离衰减
  const [min, max] = icp.employeeRange;
  if (customer.employees >= min && customer.employees <= max) score += 25;
  else {
    const dist = customer.employees < min ? min - customer.employees : customer.employees - max;
    score += Math.max(0, 25 - Math.floor(dist / 10));
  }
  // 地区（25）
  score += icp.regions.includes(customer.region) ? 25 : 0;
  // 营收（25）：达到下限满分，否则按比例
  score += Math.min(25, Math.floor((customer.revenue / icp.minRevenue) * 25));
  return score;
}

// ---------------- 2. 多维筛选 ----------------

export interface FilterCondition {
  field: keyof Customer;
  op: "eq" | "in" | "gte" | "lte" | "between" | "contains";
  value: unknown;
}

/** 组合筛选：多个条件 AND 组合 */
export function filterCustomers(customers: Customer[], conditions: FilterCondition[]): Customer[] {
  return customers.filter((c) =>
    conditions.every((cond) => {
      const val = c[cond.field];
      switch (cond.op) {
        case "eq": return val === cond.value;
        case "in": return Array.isArray(cond.value) && cond.value.includes(val as never);
        case "gte": return (val as number) >= (cond.value as number);
        case "lte": return (val as number) <= (cond.value as number);
        case "between": {
          const [lo, hi] = cond.value as [number, number];
          return (val as number) >= lo && (val as number) <= hi;
        }
        case "contains": return String(val).includes(String(cond.value));
        default: return false;
      }
    }),
  );
}

// ---------------- 3. 联系方式获取（补全）与合规 ----------------

export interface ContactInfo {
  email?: string;
  phone?: string;
  linkedin?: string;
  /** 数据来源：public(公开) / enrichment(第三方补全) / manual(人工) */
  source: "public" | "enrichment" | "manual";
  /** 是否已做合规校验（如退订链接） */
  compliant: boolean;
}

/**
 * 联系方式补全：AI 从公开渠道/第三方数据源获取联系人信息。
 * 关键：必须标记来源与合规状态，未合规的联系方式不能用于营销。
 */
export function enrichContact(customer: Customer, found: ContactInfo): Customer {
  return {
    ...customer,
    hasContact: true,
    // 真实系统中联系方式存在关联表，这里简化放进 customer 演示流程
    ...(found as object),
  } as Customer;
}

/** 合规检查：营销用途必须有合规来源且已校验 */
export function isContactCompliant(contact: ContactInfo | undefined): boolean {
  if (!contact) return false;
  return contact.compliant && (contact.source === "public" || contact.source === "enrichment");
}

// ---------------- 4. CRM 阶段推进 ----------------

export const CRM_STAGE_TRANSITIONS: Readonly<Record<Customer["stage"], readonly Customer["stage"][]>> = {
  lead: ["prospect", "lost"],
  prospect: ["qualified", "lost"],
  qualified: ["won", "lost"],
  won: [],
  lost: [],
};

export function canAdvanceStage(from: Customer["stage"], to: Customer["stage"]): boolean {
  return CRM_STAGE_TRANSITIONS[from].includes(to);
}

/** 推进阶段：lead → prospect → qualified → won，每步有准入条件 */
export function advanceStage(customer: Customer, to: Customer["stage"]): Customer {
  if (!canAdvanceStage(customer.stage, to)) {
    throw new Error(`非法阶段迁移: ${customer.stage} → ${to}`);
  }
  // 准入校验：进入 qualified 必须有联系方式
  if (to === "qualified" && !customer.hasContact) {
    throw new Error("进入 qualified 阶段必须先获取联系方式");
  }
  return { ...customer, stage: to };
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. ICP 评分：从公海客户里筛出最匹配的 =====");
  const icp: ICPProfile = {
    industries: ["制造业", "电子"],
    employeeRange: [50, 500],
    regions: ["北美", "欧洲"],
    minRevenue: 100,
  };
  const customers: Customer[] = [
    { id: "c1", name: "Acme Mfg", industry: "制造业", employees: 200, region: "北美", revenue: 300, hasContact: false, stage: "lead" },
    { id: "c2", name: "TinyShop", industry: "零售", employees: 5, region: "东南亚", revenue: 10, hasContact: false, stage: "lead" },
    { id: "c3", name: "EuroTech", industry: "电子", employees: 100, region: "欧洲", revenue: 150, hasContact: false, stage: "lead" },
  ];
  const scored = customers.map((c) => ({ c, score: icpScore(c, icp) })).sort((a, b) => b.score - a.score);
  console.log(`  c1 ${scored[0].c.name}: ${scored[0].score} 分`);
  console.log(`  c3 ${scored[1].c.name}: ${scored[1].score} 分`);
  console.log(`  c2 ${scored[2].c.name}: ${scored[2].score} 分`);
  assert(scored[0].c.id === "c1" && scored[0].score >= 75, "c1 应为最高分");
  assert(scored[2].c.id === "c2" && scored[2].score < 25, "c2 应为最低分");
  console.log("✓ ICP 评分正确排序：制造业北美大客户 > 电子欧洲 > 零售小客户");

  console.log("\n===== 2. 多维筛选：行业 + 规模 + 营收 =====");
  const filtered = filterCustomers(customers, [
    { field: "industry", op: "in", value: ["制造业", "电子"] },
    { field: "employees", op: "gte", value: 50 },
    { field: "revenue", op: "gte", value: 100 },
  ]);
  assert(filtered.length === 2, `应筛出 2 个，实际 ${filtered.length}`);
  console.log(`✓ 筛出 ${filtered.length} 个客户：${filtered.map((c) => c.name).join(", ")}`);

  console.log("\n===== 3. 联系方式补全与合规 =====");
  const enriched = enrichContact(customers[0], {
    email: "contact@acme.com",
    source: "enrichment",
    compliant: true,
  });
  assert(enriched.hasContact === true, "补全后 hasContact 应为 true");
  assert(isContactCompliant({ email: "x@y.com", source: "enrichment", compliant: true }) === true, "合规联系方式通过");
  assert(isContactCompliant({ email: "x@y.com", source: "manual", compliant: false }) === false, "不合规联系方式被拦截");
  console.log("✓ 联系方式补全 + 合规校验通过（不合规来源不可营销）");

  console.log("\n===== 4. CRM 阶段推进 =====");
  let c1 = customers[0];
  // lead → prospect
  c1 = advanceStage(c1, "prospect");
  assert(c1.stage === "prospect", "lead 可推进到 prospect");
  // prospect → qualified 需要联系方式
  let threw = false;
  try { advanceStage(c1, "qualified"); } catch { threw = true; }
  assert(threw, "无联系方式不能进 qualified");
  // 补联系方式后推进
  c1 = { ...enrichedContact(c1) };
  c1 = advanceStage(c1, "qualified");
  assert(c1.stage === "qualified", "有联系方式后可进 qualified");
  c1 = advanceStage(c1, "won");
  assert(c1.stage === "won", "qualified 可推进到 won");
  console.log("✓ CRM 阶段：lead → prospect → qualified(需联系方式) → won");

  console.log("\n✅ ICP 评分 + 多维筛选 + 联系方式合规 + CRM 阶段推进全部通过");
}

// 小助手：给 customer 加联系方式
function enrichedContact(c: Customer): Customer {
  return { ...c, hasContact: true };
}

main();
