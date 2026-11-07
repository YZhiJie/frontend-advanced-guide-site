/** 67-01-inquiry-form.ts —— B 端询盘表单：字段分层、条件校验、反垃圾评分与渠道归因 */

type InquiryType = "standard" | "custom";
type Country = "CN" | "OVERSEA";
type Channel = "search" | "ads" | "social" | "referral" | "direct";

interface Touch {
  channel: Channel;
  campaign: string;
  at: number;
}

interface RawInquiry {
  company?: string;
  contact?: string;
  email?: string;
  phone?: string;
  type: InquiryType;
  country: Country;
  budgetCents?: number;
  requirement?: string;
  consent?: boolean;
  touches: Touch[];
  submittedAt: number;
  submitCountLastMinute?: number;
}

interface FieldError {
  field: string;
  code: "required" | "format" | "range" | "consent";
  message: string;
}

interface Validated {
  ok: boolean;
  errors: FieldError[];
  spamScore: number; // 0-100,>= 60 进人工队列
  spamReasons: string[];
  attribution: { first: Channel; last: Channel; campaign: string };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CN_MOBILE_RE = /^1[3-9]\d{9}$/;
const DISPOSABLE = new Set(["qq.com", "163.com", "mailinator.com"]);
const MAX_REQUIREMENT = 2000;

/**
 * 字段分三层,校验强度完全不同:
 *   硬必填   —— 没有就无法跟进(公司、联系人、邮箱)
 *   条件必填 —— 随业务分支变化(境内要手机号、定制要预算)
 *   选填     —— 只影响转化质量,绝不阻塞提交
 * 把「选填」当必填,是 B 端表单转化率的第一杀手。
 */
function validate(raw: RawInquiry): Validated {
  const errors: FieldError[] = [];
  const push = (
    field: string,
    code: FieldError["code"],
    message: string,
  ) => errors.push({ field, code, message });

  // ---- 硬必填 ----
  if (!raw.company?.trim()) push("company", "required", "请填写公司名称");
  if (!raw.contact?.trim()) push("contact", "required", "请填写联系人");
  if (!raw.email?.trim()) push("email", "required", "请填写邮箱");
  else if (!EMAIL_RE.test(raw.email)) push("email", "format", "邮箱格式不正确");

  // ---- 条件必填:境内必须留手机号(线索外呼的唯一通道) ----
  if (raw.country === "CN" && !raw.phone?.trim()) {
    push("phone", "required", "境内询盘需填写手机号");
  }
  if (raw.country === "CN" && raw.phone?.trim() && !CN_MOBILE_RE.test(raw.phone)) {
    push("phone", "format", "手机号需为 11 位大陆号码");
  }

  // ---- 条件必填:定制询盘没有预算就无法分级跟进 ----
  if (raw.type === "custom") {
    if (raw.budgetCents === undefined) push("budget", "required", "定制需求需给出预算区间");
    else if (raw.budgetCents < 0) push("budget", "range", "预算不能为负");
  }

  // ---- 长度与合规 ----
  if (raw.requirement && raw.requirement.length > MAX_REQUIREMENT) {
    push("requirement", "range", `需求描述请控制在 ${MAX_REQUIREMENT} 字以内`);
  }
  if (!raw.consent) push("consent", "consent", "需同意隐私政策后才能提交");

  // ---- 反垃圾评分(只影响路由,不阻塞提交) ----
  const spamReasons: string[] = [];
  let spamScore = 0;
  const domain = raw.email?.split("@")[1]?.toLowerCase() ?? "";
  if (DISPOSABLE.has(domain)) {
    spamScore += 25;
    spamReasons.push(`邮箱域名 ${domain} 常被批量注册使用`);
  }
  const links = (raw.requirement?.match(/https?:\/\//g) ?? []).length;
  if (links > 0) {
    spamScore += Math.min(30, links * 10);
    spamReasons.push(`需求描述含 ${links} 个外链`);
  }
  if (/[A-Z]{8,}/.test(raw.requirement ?? "")) {
    spamScore += 10;
    spamReasons.push("需求描述出现长串大写,疑似广告");
  }
  if ((raw.submitCountLastMinute ?? 0) >= 3) {
    spamScore += 35;
    spamReasons.push("同一 IP 一分钟内提交 3 次以上");
  }
  if (raw.email && raw.phone === raw.email) {
    spamScore += 20;
    spamReasons.push("手机号与邮箱相同,疑似脚本填充");
  }
  spamScore = Math.min(100, spamScore);

  return {
    ok: errors.length === 0,
    errors,
    spamScore,
    spamReasons,
    attribution: attribute(raw.touches),
  };
}

/**
 * 归因:首触渠道回答「用户从哪来」,末触渠道回答「谁促成了这次提交」。
 * 两个都要存——只存首触会高估品牌投放,只存末触会高估收割型关键词。
 */
function attribute(touches: Touch[]): Validated["attribution"] {
  if (touches.length === 0) {
    return { first: "direct", last: "direct", campaign: "none" };
  }
  const sorted = [...touches].sort((a, b) => a.at - b.at);
  return {
    first: sorted[0].channel,
    last: sorted[sorted.length - 1].channel,
    campaign: sorted[sorted.length - 1].campaign,
  };
}

// ---- 断言 ----
const base: RawInquiry = {
  company: "某某精密制造",
  contact: "王工",
  email: "wang@example.com",
  phone: "13800138000",
  type: "standard",
  country: "CN",
  consent: true,
  touches: [
    { channel: "search", campaign: "spring-launch", at: 100 },
    { channel: "ads", campaign: "retarget", at: 200 },
  ],
  submittedAt: 300,
};

const good = validate(base);
console.assert(good.ok && good.errors.length === 0, "完整境内询盘应通过");
console.assert(good.spamScore === 0, "正常询盘不应有垃圾分");
console.assert(
  good.attribution.first === "search" && good.attribution.last === "ads",
  "首触与末触渠道应分别保留",
);

const oversea = validate({ ...base, country: "OVERSEA", phone: "+1 415 555 0100" });
console.assert(oversea.ok, "境外询盘允许非大陆手机号");

const missingPhone = validate({ ...base, phone: undefined });
console.assert(
  !missingPhone.ok && missingPhone.errors.some((e) => e.field === "phone"),
  "境内缺手机号应报必填",
);

const customNoBudget = validate({ ...base, type: "custom" });
console.assert(
  customNoBudget.errors.some(
    (e) => e.field === "budget" && e.code === "required",
  ),
  "定制询盘缺预算应报条件必填",
);

const noConsent = validate({ ...base, consent: false });
console.assert(
  noConsent.errors.some((e) => e.field === "consent"),
  "未勾选隐私政策应阻断提交",
);

const spam = validate({
  ...base,
  email: "blast@mailinator.com",
  requirement: "http://a.cn http://b.cn http://c.cn 低价代开发票 ABCDEFGHIJ",
  submitCountLastMinute: 5,
});
console.assert(spam.ok, "垃圾特征不应阻塞提交,只影响路由");
console.assert(spam.spamScore === 100, "多特征叠加应封顶 100 分");
console.assert(spam.spamReasons.length >= 4, "垃圾分应给出可解释理由");

const directOnly = attribute([]);
console.assert(
  directOnly.first === "direct" && directOnly.last === "direct",
  "无触点时归因为直接访问",
);

console.log("✅ 字段分层校验 / 条件必填 / 反垃圾评分 / 双触点归因全部通过");
