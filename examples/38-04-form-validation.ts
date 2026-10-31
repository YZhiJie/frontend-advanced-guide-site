// 文件: examples/38-04-form-validation.ts
// ============ 校验引擎：内置规则 + 自定义规则注册表 ============
// 校验器消费 Schema 的 rules + required，产出"字段 → 错误消息"的聚合结果。
// 设计要点：
// 1) 内置规则（pattern/min/max）+ custom 规则注册表（JSON 下发时规则只存 id，函数在注册表里）；
// 2) 全量校验一次出全部错误（表单提交场景），单字段校验供实时反馈复用同一实现；
// 3) 不可见字段跳过校验（隐藏字段不参与必检——用户没机会填）。

import { type FieldRule, type FormSchema, type Condition } from "./38-01-form-schema.js";
import { evalCondition } from "./38-02-form-renderer.js";

/** custom 规则注册表：规则 id → 判定函数（Schema JSON 里只存 id，函数不序列化） */
export const customValidators: Record<string, (v: unknown, all: Record<string, unknown>) => boolean> = {
    /** 手机号 */
    "phone-cn": (v) => typeof v === "string" && /^1[3-9]\d{9}$/.test(v),
    /** 金额必须为正 */
    "positive-number": (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
    /** 结束日期晚于开始日期 */
    "after-start": (v, all) => typeof v === "string" && typeof all.startDate === "string" && v > all.startDate,
};

export type ValidateErrors = Record<string, string[]>;

/** 校验单个字段（实时反馈复用） */
export function validateField(
    field: { key: string; label: string; required?: boolean; rules?: FieldRule[] },
    value: unknown,
    all: Record<string, unknown>,
): string[] {
    const errors: string[] = [];
    const empty = value === null || value === undefined || value === "";

    if (field.required && empty) {
        return [`${field.label}不能为空`]; // 必检失败不再跑后续规则，避免噪音
    }
    if (empty) return errors; // 非必填的空值不校验格式（空即合法）

    for (const rule of field.rules ?? []) {
        if (rule.type === "pattern") {
            const re = rule.value instanceof RegExp ? rule.value : new RegExp(String(rule.value));
            if (!re.test(String(value))) errors.push(rule.message);
        } else if (rule.type === "min" && typeof value === "number" && value < (rule.value as number)) {
            errors.push(rule.message);
        } else if (rule.type === "max" && typeof value === "number" && value > (rule.value as number)) {
            errors.push(rule.message);
        } else if (rule.type === "custom") {
            const fn = customValidators[String(rule.value)];
            // 注册表里没有的规则 id：按失败处理（默认拒绝原则）
            if (!fn || !fn(value, all)) errors.push(rule.message);
        }
    }
    return errors;
}

/** 全量校验：跳过不可见字段 */
export function validateForm(schema: FormSchema, values: Record<string, unknown>): ValidateErrors {
    const errors: ValidateErrors = {};
    const isVisible = (cond?: Condition) => !cond || evalCondition(cond, values);

    for (const f of schema.fields) {
        if (!isVisible(f.visibleWhen)) continue; // 隐藏字段跳过校验
        const errs = validateField(f, values[f.key], values);
        if (errs.length > 0) errors[f.key] = errs;
    }
    return errors;
}

// ---------------- 验证 ----------------

const schema: FormSchema = {
    formName: "报销申请",
    fields: [
        {
            key: "phone", type: "input", label: "手机号", required: true,
            rules: [{ type: "custom", value: "phone-cn", message: "手机号格式不正确" }],
        },
        {
            key: "amount", type: "number", label: "金额", required: true,
            rules: [
                { type: "custom", value: "positive-number", message: "金额必须大于 0" },
                { type: "max", value: 10000, message: "单笔报销不得超过 1 万元" },
            ],
        },
        { key: "startDate", type: "date", label: "开始日期" },
        {
            key: "endDate", type: "date", label: "结束日期",
            rules: [{ type: "custom", value: "after-start", message: "结束日期必须晚于开始日期" }],
        },
        {
            key: "secret", type: "input", label: "内部码", required: true,
            visibleWhen: { field: "amount", op: "gt", value: 5000 },
        },
    ],
};

console.log("=== 全部合法 ===");
console.log(validateForm(schema, { phone: "13812341234", amount: 3000, startDate: "2026-10-01", endDate: "2026-10-05" }));

console.log("\n=== 多字段同时报错（聚合而非短路） ===");
console.log(validateForm(schema, { phone: "123", amount: -5, startDate: "2026-10-10", endDate: "2026-10-01" }));

console.log("\n=== 隐藏字段跳过校验 ===");
// amount=3000 → secret 不可见 → 即使 secret 为空也通过
console.log(validateForm(schema, { phone: "13812341234", amount: 3000, startDate: "2026-10-01", endDate: "2026-10-05", secret: "" }));
// amount=8000 → secret 可见 → 为空报错
console.log(validateForm(schema, { phone: "13812341234", amount: 8000, startDate: "2026-10-01", endDate: "2026-10-05", secret: "" }));

console.log("\n=== 实时反馈复用单字段校验 ===");
console.log(validateField(schema.fields[0]!, "", {})); // 必检
console.log(validateField(schema.fields[0]!, "13812341234", {})); // []
