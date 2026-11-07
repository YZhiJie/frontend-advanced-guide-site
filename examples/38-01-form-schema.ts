// 文件: examples/38-01-form-schema.ts
// ============ 表单 Schema：一份 JSON 描述一张表单 ============
// 低代码表单的基石：把"表单长什么样、怎么校验、怎么联动"全部数据化。
// Schema 是契约——渲染器、校验器、联动引擎、导入导出全部消费同一份数据。
// 本文件先定义 Schema 类型并实现"Schema 自检"：一份非法 Schema 应在构建期被拒绝，
// 而不是运行到一半渲染崩掉。

export type FieldType = "input" | "textarea" | "number" | "select" | "date" | "switch";

export interface FieldOption {
    label: string;
    value: string | number;
}

export interface FieldSchema {
    key: string;              // 提交时的字段名（全表单唯一）
    type: FieldType;
    label: string;
    required?: boolean;
    defaultValue?: unknown;
    placeholder?: string;
    options?: FieldOption[];  // select 专用
    rules?: FieldRule[];
    visibleWhen?: Condition;  // 联动：不满足则从渲染树移除（连值一起剔除）
    disabledWhen?: Condition; // 联动：可见但不可编辑
    colSpan?: 1 | 2;          // 布局：占几列
}

export interface FieldRule {
    type: "pattern" | "min" | "max" | "custom";
    value?: unknown;
    message: string;
    /** custom 规则的判定函数（仅内存构建用；JSON 下发时用规则 id 引用注册表） */
    validate?: (v: unknown, all: Record<string, unknown>) => boolean;
}

/** 联动条件：field 的值与 compare 按运算符比较（结构化而非字符串表达式，可安全 JSON 下发） */
export interface Condition {
    field: string;
    op: "eq" | "neq" | "in" | "gt" | "truthy";
    value?: unknown;
}

export interface FormSchema {
    formName: string;
    fields: FieldSchema[];
}

/** Schema 自检：构建期拦住非法配置。返回错误列表，空数组 = 合法 */
export function validateSchema(schema: FormSchema): string[] {
    const errors: string[] = [];
    const keys = new Set<string>();

    if (schema.fields.length === 0) errors.push("表单至少需要一个字段");

    for (const f of schema.fields) {
        if (!f.key) errors.push(`字段缺少 key: ${JSON.stringify(f.label)}`);
        else if (keys.has(f.key)) errors.push(`字段 key 重复: ${f.key}`);
        else keys.add(f.key);

        if (f.type === "select" && (!f.options || f.options.length === 0)) {
            errors.push(`select 字段 ${f.key} 必须提供 options`);
        }
        if (f.visibleWhen && !keys.has(f.visibleWhen.field) && !schema.fields.some((x) => x.key === f.visibleWhen!.field)) {
            errors.push(`字段 ${f.key} 的 visibleWhen 引用了不存在的字段: ${f.visibleWhen.field}`);
        }
        for (const r of f.rules ?? []) {
            if (r.type === "pattern" && !(r.value instanceof RegExp) && typeof r.value !== "string") {
                errors.push(`字段 ${f.key} 的 pattern 规则缺少 value`);
            }
        }
    }
    return errors;
}

// ---------------- 验证 ----------------

const good: FormSchema = {
    formName: "请假申请",
    fields: [
        { key: "name", type: "input", label: "姓名", required: true },
        { key: "days", type: "number", label: "请假天数", required: true, colSpan: 1 },
        {
            key: "reason", type: "textarea", label: "请假事由", colSpan: 2,
            required: true, visibleWhen: { field: "days", op: "gt", value: 0 },
        },
        {
            key: "proxy", type: "select", label: "代理人工号", colSpan: 1,
            options: [{ label: "张三", value: "e001" }, { label: "李四", value: "e002" }],
            required: true, visibleWhen: { field: "days", op: "gt", value: 3 },
        },
    ],
};

console.log("=== 合法 Schema 自检 ===");
console.log("错误数:", validateSchema(good)); // 0

console.log("\n=== 非法 Schema 自检 ===");
const bad: FormSchema = {
    formName: "坏表单",
    fields: [
        { key: "a", type: "input", label: "A" },
        { key: "a", type: "input", label: "A2" },                       // key 重复
        { key: "b", type: "select", label: "B" },                       // select 无 options
        { key: "c", type: "input", label: "C", visibleWhen: { field: "nope", op: "eq", value: 1 } }, // 引用不存在字段
    ],
};
console.log(validateSchema(bad));

console.log("\n=== Schema 即数据：可序列化下发 ===");
console.log("JSON 字节数:", JSON.stringify(good).length, "（一张业务表单不到 1KB）");
