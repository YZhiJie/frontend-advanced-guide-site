/** 67-03-kyc-stepper.ts —— 多步骤 KYC 表单：分支步骤机、补件回流与进度计算 */

type EntityType = "individual" | "company";
type StepId = "basic" | "identity" | "business" | "ubo" | "address" | "documents" | "review";
type DocId = "idCard" | "license" | "bankStatement" | "uboDeclaration" | "boardResolution";
type DocStatus = "missing" | "pending" | "approved" | "rejected";

interface Doc {
  status: DocStatus;
  reason?: string;
}

interface KycState {
  entityType: EntityType;
  answers: Record<string, string>;
  docs: Record<DocId, Doc>;
  expiresAt: Record<string, number>; // 证件到期时间戳,0 表示未填
}

interface StepDef {
  id: StepId;
  title: string;
  applies: (s: KycState) => boolean;
  fields: string[];
  docs: DocId[];
  /** 前置步骤:决定「能不能点进去」而不是「能不能跳过」 */
  after: StepId[];
}

const STEPS: StepDef[] = [
  { id: "basic", title: "主体与联系人", applies: () => true, fields: ["name", "country", "contact"], docs: [], after: [] },
  { id: "identity", title: "证件信息", applies: () => true, fields: ["idNumber", "idExpiry"], docs: ["idCard"], after: ["basic"] },
  {
    id: "business",
    title: "企业资质",
    applies: (s) => s.entityType === "company",
    fields: ["legalName", "registrationNo", "industry"],
    docs: ["license"],
    after: ["basic"],
  },
  {
    id: "ubo",
    title: "实际受益人",
    applies: (s) => s.entityType === "company",
    fields: ["uboName", "uboSharePct"],
    docs: ["uboDeclaration"],
    after: ["business"],
  },
  { id: "address", title: "地址与账单", applies: () => true, fields: ["address", "postcode"], docs: ["bankStatement"], after: ["identity"] },
  {
    id: "documents",
    title: "补充材料",
    applies: () => true,
    fields: [],
    docs: ["boardResolution"],
    after: [],
  },
  { id: "review", title: "提交审核", applies: () => true, fields: [], docs: [], after: ["address"] },
];

const DOC_LABEL: Record<DocId, string> = {
  idCard: "身份证件",
  license: "营业执照",
  bankStatement: "银行对账单",
  uboDeclaration: "受益人声明",
  boardResolution: "董事会决议",
};

interface StepView {
  id: StepId;
  title: string;
  status: "locked" | "todo" | "supplement" | "done";
  missingFields: string[];
  missingDocs: DocId[];
}

interface Evaluation {
  steps: StepView[];
  progress: number; // 0-100
  next: StepId | null;
  supplements: StepId[];
  blockers: string[];
}

/** 证件过期是硬阻塞:补件可以后置,但过期证件不允许提交 */
function idExpired(s: KycState, now: number) {
  const expiry = s.expiresAt.idExpiry ?? 0;
  return expiry !== 0 && expiry < now;
}

function evaluate(s: KycState, now: number): Evaluation {
  const steps: StepView[] = [];
  for (const def of STEPS) {
    if (!def.applies(s)) continue;
    const missingFields = def.fields.filter((f) => !s.answers[f]?.trim());
    const missingDocs = def.docs.filter((d) => s.docs[d]?.status !== "approved");
    const rejected = def.docs.filter((d) => s.docs[d]?.status === "rejected");
    const locked = def.after.some((a) => {
      const prev = steps.find((x) => x.id === a);
      return !prev || prev.status !== "done";
    });
    const status: StepView["status"] = rejected.length
      ? "supplement"
      : locked
        ? "locked"
        : missingFields.length === 0 && missingDocs.length === 0
          ? "done"
          : "todo";
    steps.push({ id: def.id, title: def.title, status, missingFields, missingDocs });
  }

  const actionable = steps.filter((x) => x.status !== "locked");
  const doneCount = steps.filter((x) => x.status === "done").length;
  const progress = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;

  // 补件优先:被驳回的步骤必须回到队首,否则用户会在已完成的步骤里反复打转
  const supplements = steps.filter((x) => x.status === "supplement").map((x) => x.id);
  const next =
    supplements[0] ??
    steps.find((x) => x.status === "todo")?.id ??
    (actionable.length === steps.length && doneCount === steps.length ? "review" : null);

  const blockers: string[] = [];
  if (idExpired(s, now)) blockers.push("身份证件已过期,需换证后重新提交");
  if (s.entityType === "company" && s.answers.uboSharePct) {
    const pct = Number(s.answers.uboSharePct);
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      blockers.push("受益股份比例需在 1~100 之间");
    }
  }
  if (!s.answers.country) blockers.push("请选择注册国家/地区,否则无法确定适用规则");

  return { steps, progress, next, supplements, blockers };
}

function supplementHint(s: KycState, stepId: StepId): string[] {
  const def = STEPS.find((x) => x.id === stepId);
  if (!def) return [];
  return def.docs
    .filter((d) => s.docs[d]?.status === "rejected")
    .map((d) => `${DOC_LABEL[d]}:${s.docs[d].reason ?? "未说明原因"}`);
}

// ---- 断言 ----
const blankCompany: KycState = {
  entityType: "company",
  answers: {},
  docs: {
    idCard: { status: "missing" },
    license: { status: "missing" },
    bankStatement: { status: "missing" },
    uboDeclaration: { status: "missing" },
    boardResolution: { status: "missing" },
  },
  expiresAt: {},
};

const start = evaluate(blankCompany, 100);
console.assert(start.next === "basic", "空白企业应从第一步开始");
console.assert(
  start.steps.map((x) => x.id).join(",") === "basic,identity,business,ubo,address,documents,review",
  "企业分支应包含 business/ubo 两步",
);
console.assert(start.progress === 0, "未完成任何步骤进度为 0");

const individual = evaluate({ ...blankCompany, entityType: "individual" }, 100);
console.assert(
  !individual.steps.some((x) => x.id === "business" || x.id === "ubo"),
  "个人分支不出现企业资质与受益人步骤",
);
console.assert(individual.steps.length === 5, "个人分支共 5 步");

const filledBasic: KycState = {
  ...blankCompany,
  answers: { name: "某某科技", country: "CN", contact: "李经理" },
};
const afterBasic = evaluate(filledBasic, 100);
console.assert(afterBasic.steps[0].status === "done", "基本信息填完即为 done");
console.assert(afterBasic.next === "identity", "下一步解锁证件信息");
console.assert(
  afterBasic.steps.find((x) => x.id === "ubo")!.status === "locked",
  "ubo 依赖 business,未完成时锁定",
);

const rejectedDoc: KycState = {
  ...filledBasic,
  docs: {
    ...filledBasic.docs,
    idCard: { status: "rejected", reason: "照片反光,信息不可读" },
  },
  answers: { ...filledBasic.answers },
};
const supplement = evaluate(rejectedDoc, 100);
console.assert(supplement.next === "identity", "被驳回的补件步骤优先回到队首");
console.assert(
  supplement.steps.find((x) => x.id === "identity")!.status === "supplement",
  "驳回状态标记为 supplement",
);
console.assert(
  supplementHint(rejectedDoc, "identity")[0].includes("照片反光"),
  "补件提示应带审核员给出的具体原因",
);

const expired: KycState = {
  ...rejectedDoc,
  expiresAt: { idExpiry: 50 },
};
const blocked = evaluate(expired, 100);
console.assert(blocked.blockers.some((b) => b.includes("已过期")), "证件过期是硬阻塞");
console.assert(blocked.next === "identity", "阻塞不改变下一步指向,只禁止提交");

const badPercent: KycState = {
  ...filledBasic,
  answers: { ...filledBasic.answers, uboSharePct: "120" },
};
console.assert(
  evaluate(badPercent, 100).blockers.some((b) => b.includes("1~100")),
  "受益比例越界应报阻塞",
);

const allDone: KycState = {
  entityType: "company",
  answers: {
    name: "某某科技",
    country: "CN",
    contact: "李经理",
    idNumber: "110101199001011234",
    idExpiry: "2030-01-01",
    legalName: "某某科技有限公司",
    registrationNo: "91110000MA01",
    industry: "制造",
    uboName: "张三",
    uboSharePct: "60",
    address: "北京市朝阳区",
    postcode: "100020",
  },
  docs: {
    idCard: { status: "approved" },
    license: { status: "approved" },
    bankStatement: { status: "approved" },
    uboDeclaration: { status: "approved" },
    boardResolution: { status: "approved" },
  },
  expiresAt: { idExpiry: 100000 },
};
const finished = evaluate(allDone, 100);
console.assert(finished.progress === 100, "全部通过时进度为 100");
console.assert(finished.next === "review", "完成所有步骤后指向提交审核");
console.assert(finished.blockers.length === 0, "资料齐全时无阻塞");

console.log("✅ 分支步骤机 / 补件回流 / 锁定前置 / 进度与阻塞全部通过");
