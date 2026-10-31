// 文件: examples/37-05-field-masking.ts
// ============ 字段级权限与数据脱敏 ============
// 列表接口返回的记录，不同角色能看到/导出的字段不同：
// - 字段白名单：能看哪些列（能力问题，Ability 判定）
// - 脱敏规则：能看的字段以什么形态看（展示问题，mask 函数）
// 原则：脱敏在"序列化出口"统一做（服务端渲染/导出/接口网关），
// 前端组件不各自散落 replace——出口一处收口，漏了只漏一处。

import { Ability, AbilityBuilder } from "./37-04-can-checker.js";

export interface Customer {
    id: string;
    name: string;
    phone: string;
    idCard: string;
    balance: number;
    note: string;
}

/** 脱敏器集合：每个函数只管一种格式 */
export const maskers = {
    /** 手机号：138****1234 */
    phone: (v: string) => v.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2"),
    /** 身份证：前 4 后 2 */
    idCard: (v: string) => v.replace(/^(.{4}).+(.{2})$/, "$1**********$2"),
    /** 金额：完全隐藏 */
    hidden: () => "***",
    /** 数字金额区间化：<1w / 1-10w / >10w（分析场景比全遮更可用） */
    bucket: (v: number) => (v < 10_000 ? "<1w" : v < 100_000 ? "1-10w" : ">10w"),
} as const;

export interface FieldPolicy {
    /** 该角色可读的字段（白名单） */
    readableFields: readonly (keyof Customer)[];
    /** 字段 → 脱敏器（未列出的字段原样输出） */
    masking: Partial<Record<keyof Customer, (v: never) => unknown>>;
}

/** 出口统一裁剪：白名单之外的字段直接不出现（而不是置 null——避免结构泄露） */
export function sanitize<T extends object>(record: T, policy: FieldPolicy): Partial<T> {
    const out: Partial<T> = {};
    for (const field of policy.readableFields) {
        const masker = policy.masking[field] as ((v: unknown) => unknown) | undefined;
        (out as Record<string, unknown>)[field] = masker
            ? masker(record[field as keyof T])
            : record[field as keyof T];
    }
    return out;
}

// ---------------- 验证 ----------------

const customer: Customer = {
    id: "c1",
    name: "张三",
    phone: "13812341234",
    idCard: "330102199001011234",
    balance: 66_000,
    note: "VIP 客户",
};

/** 客服：能看基础字段，手机号脱敏，余额不可见 */
const csPolicy: FieldPolicy = {
    readableFields: ["id", "name", "phone", "note"],
    masking: { phone: maskers.phone },
};

/** 风控：全字段可读，但金额区间化、证件脱敏 */
const riskPolicy: FieldPolicy = {
    readableFields: ["id", "name", "phone", "idCard", "balance", "note"],
    masking: { idCard: maskers.idCard, balance: maskers.bucket },
};

console.log("=== 客服视角 ===");
console.log(sanitize(customer, csPolicy));

console.log("\n=== 风控视角 ===");
console.log(sanitize(customer, riskPolicy));

console.log("\n=== 与 Ability 联动：字段级 can() 决定白名单 ===");
const { can, build } = new AbilityBuilder();
can("read", "Customer", ["id", "name", "phone", "note"]);
const ability: Ability = build();

const fieldsOf: readonly (keyof Customer)[] = ["id", "name", "phone", "idCard", "balance", "note"];
const dynamicPolicy: FieldPolicy = {
    readableFields: fieldsOf.filter((f) => ability.can("read", "Customer", f)),
    masking: { phone: maskers.phone },
};
console.log("由 can() 动态生成的白名单:", dynamicPolicy.readableFields);
console.log(sanitize(customer, dynamicPolicy));

console.log("\n=== 反面模式：逐个组件手动 replace（不可持续） ===");
console.log("// ❌ 每个页面各自 customer.phone.replace(...) —— 新角色上线必漏一处");
console.log("// ✅ 出口统一 sanitize(record, policy) —— 规则集中，测试一处覆盖");
