// 文件: examples/85-01-form-field-model.ts
// ============ React Hook Form 表单模型：字段注册 + 错误收集 + Zod 校验 ============
// 对应 JD 技术栈 React Hook Form。演示 RHF 的核心模型：字段注册表、错误收集、
// 与 Zod 的 Schema 校验集成。纯 TS 可直跑。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 极简 Zod（仅用于演示，真实用 zod 库） ----------------
// 真实项目里用 import { z } from "zod"，这里手写最小实现跑通流程

type Validator = (val: unknown) => string | null; // 返回 null 表示通过，否则返回错误信息

class ZString {
  private checks: Validator[] = [];
  min(len: number, msg = `最少 ${len} 个字符`) { this.checks.push((v) => (typeof v === "string" && v.length >= len ? null : msg)); return this; }
  email(msg = "邮箱格式不正确") { this.checks.push((v) => (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : msg)); return this; }
  parse(val: unknown): string {
    for (const c of this.checks) { const err = c(val); if (err) throw new Error(err); }
    return String(val);
  }
  safeParse(val: unknown): { success: boolean; data?: string; error?: string } {
    try { return { success: true, data: this.parse(val) }; } catch (e) { return { success: false, error: (e as Error).message }; }
  }
}

const z = { string: () => new ZString() };

// ---------------- 表单模型：字段注册 + 值 + 错误 ----------------

export interface FieldRegistration {
  name: string;
  /** 校验规则：返回 null 通过，否则错误信息 */
  validate?: (val: unknown) => string | null;
  required?: boolean;
}

export interface FormState {
  values: Record<string, unknown>;
  errors: Record<string, string>;
  /** 哪些字段被触碰过（用于"只在失焦后显示错误"） */
  touched: Record<string, boolean>;
}

/** 表单引擎：字段注册、设值、校验 */
export class FormEngine {
  private fields = new Map<string, FieldRegistration>();
  private state: FormState = { values: {}, errors: {}, touched: {} };

  register(field: FieldRegistration): void {
    this.fields.set(field.name, field);
    this.state.values[field.name] = undefined;
  }

  setValue(name: string, value: unknown): void {
    this.state.values[name] = value;
    this.validateField(name);
  }

  setTouched(name: string): void {
    this.state.touched[name] = true;
    this.validateField(name);
  }

  private validateField(name: string): void {
    const field = this.fields.get(name);
    if (!field) return;
    const val = this.state.values[name];
    // required 校验
    if (field.required && (val === undefined || val === null || val === "")) {
      this.state.errors[name] = "此字段必填";
      return;
    }
    // 自定义校验
    if (field.validate) {
      const err = field.validate(val);
      this.state.errors[name] = err ?? "";
    } else {
      this.state.errors[name] = "";
    }
  }

  /** 校验全部字段，返回是否有效 */
  validateAll(): boolean {
    for (const name of this.fields.keys()) this.validateField(name);
    return Object.values(this.state.errors).every((e) => !e);
  }

  getState(): FormState {
    return this.state;
  }

  getValues(): Record<string, unknown> {
    return { ...this.state.values };
  }
}

// ---------------- Zod Schema 校验集成 ----------------

/** 把 Zod Schema 的校验结果转成表单错误 */
export function schemaToFormErrors<T extends Record<string, unknown>>(
  values: T,
  schema: Record<keyof T, ZString>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of Object.keys(schema) as (keyof T)[]) {
    const result = schema[key].safeParse(values[key]);
    if (!result.success) errors[key as string] = result.error!;
  }
  return errors;
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. 字段注册 + 必填校验 =====");
  const form = new FormEngine();
  form.register({ name: "name", required: true });
  form.register({ name: "email", required: true, validate: (v) => (typeof v === "string" && v.includes("@") ? null : "邮箱格式不正确") });

  // 初始值都是 undefined，必填校验失败
  assert(form.validateAll() === false, "空表单校验应失败");
  assert(form.getState().errors["name"] === "此字段必填", "name 应报必填错误");
  console.log("✓ 空表单：name 必填错误、email 必填错误");

  // 填值
  form.setValue("name", "张三");
  form.setValue("email", "bad-email");
  assert(form.getState().errors["email"] === "邮箱格式不正确", "email 格式错误");
  console.log("✓ 填值后：name 通过，email 报格式错误");

  // 修正 email
  form.setValue("email", "zhang@example.com");
  assert(form.validateAll() === true, "修正后校验通过");
  assert(form.getValues().name === "张三", "表单值正确");
  console.log("✓ 修正 email 后表单校验通过");

  console.log("\n===== 2. 失焦后才显示错误（touched） =====");
  const form2 = new FormEngine();
  form2.register({ name: "phone", required: true });
  // 设置值但未 touched，touched 里没有 phone
  form2.setValue("phone", "");
  assert(form2.getState().touched["phone"] !== true, "未失焦时 touched 为 false");
  // 真实 UI 里：只对 touched 的字段显示错误，未触碰的不显示红框
  form2.setTouched("phone");
  assert(form2.getState().touched["phone"] === true, "失焦后 touched 为 true");
  assert(form2.getState().errors["phone"] === "此字段必填", "失焦后触发校验");
  console.log("✓ touched 机制：未失焦不显示错误，失焦后才校验");

  console.log("\n===== 3. Zod Schema 集成校验 =====");
  const schema = {
    username: z.string().min(3, "用户名至少 3 个字符"),
    email: z.string().email(),
  };
  const values = { username: "ab", email: "not-an-email" };
  const errs = schemaToFormErrors(values, schema);
  assert(errs["username"] === "用户名至少 3 个字符", "username 长度校验");
  assert(errs["email"] === "邮箱格式不正确", "email 格式校验");
  console.log(`✓ Schema 校验：username → ${errs["username"]}，email → ${errs["email"]}`);

  // 合法值通过
  const okValues = { username: "alice", email: "alice@example.com" };
  const okErrs = schemaToFormErrors(okValues, schema);
  assert(Object.keys(okErrs).length === 0, "合法值无错误");
  console.log("✓ 合法值通过 Schema 校验，无错误");

  console.log("\n✅ 字段注册 + 必填校验 + touched + Zod Schema 集成全部通过");
}

main();
