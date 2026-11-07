/**
 * 第 102 部分 · Element Plus 企业实战
 * el-form 校验封装：Schema DSL → Zod 兼容校验器
 * 衔接 33 册 Schema 与类型校验：el-form rules 与 Zod schema 互转
 * 运行：npx tsx examples/102-02-elform-schema-to-zod.ts
 */
import assert from "node:assert";

// ---------- 1. el-form Rule DSL（简化版，仅覆盖高频字段） ----------
export interface ElRule {
  required?: boolean;
  message?: string;
  trigger?: "blur" | "change";
  min?: number;
  max?: number;
  len?: number;
  pattern?: RegExp;
  type?: "string" | "number" | "email" | "url" | "array";
  validator?: (value: unknown) => string | null; // 自定义简化版（el-form 是 (rule, value, cb)）
}

export type ElSchema = Record<string, ElRule[]>;

// ---------- 2. Schema → 轻量校验器（模拟 Zod.parse 接口） ----------
interface ValidationResult {
  ok: boolean;
  errors: Record<string, string[]>; // field → error messages
  firstError?: string;
}

function buildValidator(schema: ElSchema) {
  return {
    parse(input: Record<string, unknown>): ValidationResult {
      const errors: Record<string, string[]> = {};
      for (const [field, rules] of Object.entries(schema)) {
        const fieldErrors: string[] = [];
        const value = input?.[field];
        const str = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value ?? "");

        for (const rule of rules) {
          // 必填
          if (rule.required && (value === undefined || value === null || str === "")) {
            fieldErrors.push(rule.message ?? `${field}: 必填`);
            continue; // 必填失败后不再检查后续规则
          }
          // 跳过空值（仅非必填字段）
          if (!rule.required && str === "") continue;

          // 长度范围（min/max）
          if (typeof value === "string") {
            if (rule.min !== undefined && str.length < rule.min) {
              fieldErrors.push(rule.message ?? `${field}: 至少 ${rule.min} 位`);
            }
            if (rule.max !== undefined && str.length > rule.max) {
              fieldErrors.push(rule.message ?? `${field}: 最多 ${rule.max} 位`);
            }
            if (rule.len !== undefined && str.length !== rule.len) {
              fieldErrors.push(rule.message ?? `${field}: 必须 ${rule.len} 位`);
            }
          }

          // 类型校验
          if (rule.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
            fieldErrors.push(rule.message ?? `${field}: 邮箱格式错误`);
          }
          if (rule.type === "url" && !/^https?:\/\/.+\..+/.test(str)) {
            fieldErrors.push(rule.message ?? `${field}: URL 格式错误`);
          }
          if (rule.type === "number" && value !== "" && Number.isNaN(Number(value))) {
            fieldErrors.push(rule.message ?? `${field}: 必须是数字`);
          }

          // 正则
          if (rule.pattern && !rule.pattern.test(str)) {
            fieldErrors.push(rule.message ?? `${field}: 格式不符合规则`);
          }

          // 自定义 validator
          if (rule.validator) {
            const err = rule.validator(value);
            if (err) fieldErrors.push(err);
          }
        }

        if (fieldErrors.length) errors[field] = fieldErrors;
      }

      const errorList = Object.values(errors).flat();
      return { ok: errorList.length === 0, errors, firstError: errorList[0] };
    },
  };
}

// ---------- 3. 同一 Schema 驱动 el-form（模板）+ Zod（数据契约） ----------
const userSchema: ElSchema = {
  username: [
    { required: true, message: "请输入用户名" },
    { min: 3, max: 20, message: "用户名需 3-20 位" },
    { pattern: /^[a-zA-Z0-9_]+$/, message: "仅支持字母数字下划线" },
  ],
  email: [
    { required: true, message: "请输入邮箱", trigger: "blur" },
    { type: "email", message: "邮箱格式不正确" },
  ],
  age: [
    { type: "number", message: "年龄必须是数字" },
    {
      validator: (v) => {
        const n = Number(v);
        if (v !== "" && (n < 18 || n > 120)) return "年龄需在 18-120 之间";
        return null;
      },
    },
  ],
};

const validate = buildValidator(userSchema);

// 场景 A：全部合法
const pass = validate.parse({ username: "admin_01", email: "a@b.com", age: 25 });
assert.ok(pass.ok);
assert.deepEqual(pass.errors, {});
console.log("[A] 全部合法 → ✓");

// 场景 B：多项同时失败
const fail = validate.parse({ username: "a", email: "bad", age: 15 });
assert.ok(!fail.ok);
// username="a" → min:3 失败，message "用户名需 3-20 位"（schema 里明确写了 message）
assert.ok(fail.errors.username?.some?.((e) => e.includes("3-20")),
  "username min:3 失败应命中 '3-20'：实际 = " + JSON.stringify(fail.errors.username));
// 注意：fail.errors.email 是字符串数组！数组 includes 检查精确匹配，不是子串
assert.ok(fail.errors.email?.some?.((e) => e.includes("邮箱格式")),
  "email type:email 失败应命中 '邮箱格式'：实际 = " + JSON.stringify(fail.errors.email));
assert.ok(fail.errors.age?.some?.((e) => e.includes("18-120")),
  "age custom validator 应命中 '18-120'：实际 = " + JSON.stringify(fail.errors.age));
assert.ok(Object.keys(fail.errors).length >= 2, "至少 username + email 两个字段报错");
console.log("[B] 三项同时失败 → 字段级错误映射 OK，username=", fail.errors.username, "email=", fail.errors.email, "firstError =", fail.firstError);

// 场景 C：自定义 validator 失败
const customFail = validate.parse({ username: "good", email: "e@f.com", age: 17 });
assert.ok(!customFail.ok);
assert.ok(customFail.errors.age?.some?.((e) => e.includes("18-120")),
  "age custom validator 应命中 '18-120'：实际 = " + JSON.stringify(customFail.errors.age));
console.log("[C] 自定义 validator 拦截 age=17 → ✓");

// 场景 D：空值 + required 边界
const partial = validate.parse({ username: "", email: "", age: "" });
assert.ok(!partial.ok);
assert.ok(partial.errors.username?.some((e) => e.includes("请输入")));
assert.ok(partial.errors.email?.some((e) => e.includes("请输入")));
// age 没设 required，空值应跳过
assert.equal(partial.errors.age, undefined, "非必填字段空值不应报错");
console.log("[D] 空值边界：必填字段报错，非必填跳过 → ✓");

// ---------- 4. el-form 与 Zod 共用同一套校验 ----------
// 真实项目：el-form :rules="computedRules" 消费这份 schema
// 后端契约：Zod schema 通过 zodToJsonSchema 生成 OpenAPI 校验
// 前端测试：同一套 schema 在 vitest 里做单元测试
// 示例：trigger 语义的差异（el-form 有 trigger，Zod 没有）
const withTrigger: ElRule = { required: true, message: "必填", trigger: "blur" };
const withoutTrigger: ElRule = { required: true, message: "必填" };
const schemaWith: ElSchema = { name: [withTrigger] };
const schemaWithout: ElSchema = { name: [withoutTrigger] };
// trigger 不影响校验逻辑，只影响 el-form 的交互时机
assert.deepEqual(buildValidator(schemaWith).parse({ name: "" }), buildValidator(schemaWithout).parse({ name: "" }));
console.log("[E] trigger 语义（el-form 独有）不影响校验逻辑，Zod 与 el-form 可共用 schema → ✓");

console.log("✅ 102-02 全部断言通过");
