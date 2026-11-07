// 文件: examples/131-01-schema-form-model.ts
// 131.1 / 131.4 Schema 作为单一事实来源：z.input 与 z.output、错误路径扁平化、
// touched/dirty 与「错误何时可见」。
// 真实依赖 zod@3.25（examples/node_modules），npx tsx 实跑。
import assert from "node:assert/strict";
import { z } from "zod";

// ---------------- 1) Schema：校验 + 归一化 + 跨字段规则 ----------------
// trim/lowercase 属于「解析期归一化」：校验通过后得到的才是干净值。
const SignupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
    age: z.coerce.number().int("年龄必须是整数").min(18, "需年满 18 岁"),
    plan: z.enum(["free", "pro"]),
    company: z.string().trim().optional(),
    coupon: z.string().trim().default(""),
  })
  .superRefine((value, ctx) => {
    if (value.plan === "pro" && !value.company) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["company"],
        message: "Pro 套餐需填写公司名",
      });
    }
  });

// z.input 是「表单里放进去的东西」，z.output 是「校验后的干净值」。
// 有 default/transform 时两者不同：输入允许缺省，输出一定存在。
type SignupInput = z.input<typeof SignupSchema>;
type Signup = z.output<typeof SignupSchema>;

const raw: SignupInput = {
  email: "  Alice@Example.COM ",
  age: "20", // 表单控件给的是字符串
  plan: "free",
  // company、coupon 缺省
};

const parsed = SignupSchema.safeParse(raw);
assert.equal(parsed.success, true, "合法输入应通过");
if (!parsed.success) throw new Error("unreachable");
const clean: Signup = parsed.data;
assert.equal(clean.email, "alice@example.com", "trim + lowercase 在解析期完成");
assert.equal(clean.age, 20, "z.coerce 把字符串转成数字");
assert.equal(typeof clean.age, "number");
assert.equal(clean.coupon, "", "default 让输出一定有值");
assert.equal(clean.company, undefined, "optional 字段保持 undefined");

// 基础校验失败：superRefine 不会执行（对象本身都没解析成功）
const badBase = SignupSchema.safeParse({ email: "nope", age: "17", plan: "free" });
assert.equal(badBase.success, false);
if (badBase.success) throw new Error("unreachable");
assert.deepEqual(
  badBase.error.issues.map((i) => i.path.join(".")),
  ["email", "age"],
  "两条字段错误都在，且路径可定位",
);

// 基础校验通过、跨字段规则失败：错误挂在 company 上
const badCross = SignupSchema.safeParse({ email: "a@b.com", age: 20, plan: "pro" });
assert.equal(badCross.success, false);
if (badCross.success) throw new Error("unreachable");
assert.equal(badCross.error.issues[0]?.path.join("."), "company");
assert.equal(badCross.error.issues[0]?.message, "Pro 套餐需填写公司名");

// ---------------- 2) 错误扁平化：首条为准 ----------------
export function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_form";
    // 同一字段可能有多条规则命中；UI 只展示第一条，避免刷屏
    if (!(path in out)) out[path] = issue.message;
  }
  return out;
}

const flat = flattenIssues(badBase.error);
assert.deepEqual(flat, { email: "邮箱格式不正确", age: "需年满 18 岁" });

const formLevel = z.object({ items: z.array(z.string()).min(1, "至少一项") });
const emptyItems = formLevel.safeParse({ items: [] });
assert.equal(emptyItems.success, false);
if (emptyItems.success) throw new Error("unreachable");
assert.deepEqual(flattenIssues(emptyItems.error), { items: "至少一项" }, "数组级错误落在 items 上");

// ---------------- 3) 表单模型：touched / dirty / 错误可见性 ----------------
interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: z.ZodError };
}

export class FormModel<TValues extends Record<string, unknown>> {
  #values: Partial<TValues>;
  readonly #baseline: Partial<TValues>;
  #touched = new Set<string>();
  #errors: Record<string, string> = {};
  #submitAttempted = false;

  constructor(
    private readonly parser: Parser<TValues>,
    initial: Partial<TValues>,
  ) {
    this.#values = { ...initial };
    this.#baseline = { ...initial };
  }

  get values(): Partial<TValues> {
    return { ...this.#values };
  }

  get errors(): Record<string, string> {
    return { ...this.#errors };
  }

  setValue(name: string, value: unknown): void {
    (this.#values as Record<string, unknown>)[name] = value;
  }

  blur(name: string): void {
    this.#touched.add(name);
  }

  isTouched(name: string): boolean {
    return this.#touched.has(name);
  }

  isDirty(name: string): boolean {
    return this.#values[name] !== this.#baseline[name];
  }

  /** 首屏不打扰：未碰过、也没提交过，就不显示错误 */
  errorOf(name: string): string | undefined {
    if (!this.#touched.has(name) && !this.#submitAttempted) return undefined;
    return this.#errors[name];
  }

  submit(): { ok: boolean; data?: TValues } {
    this.#submitAttempted = true;
    const result = this.parser.safeParse(this.#values);
    if (result.success) {
      this.#errors = {};
      return { ok: true, data: result.data };
    }
    this.#errors = flattenIssues(result.error);
    return { ok: false };
  }
}

const form = new FormModel<Signup>(SignupSchema, {
  email: "a@b.com",
  age: 20,
  plan: "free",
});

// 初始值合法，但字段被改成非法值；未 blur 前不显示错误
form.setValue("email", "broken");
assert.equal(form.errorOf("email"), undefined, "未触碰不报错，避免一上来就红");
assert.equal(form.isDirty("email"), true, "和基线不同即为脏");
form.blur("email");
assert.equal(form.errorOf("email"), undefined, "blur 只标记 touched，错误要等校验跑过");

const failed = form.submit();
assert.equal(failed.ok, false);
assert.equal(form.errorOf("email"), "邮箱格式不正确", "提交后错误可见");
assert.equal(form.errorOf("age"), undefined, "合法字段无错误");

form.setValue("email", "a@b.com");
assert.equal(form.isDirty("email"), false, "改回原值即不再脏");
assert.equal(form.submit().ok, true, "全部合法时提交通过");

// 表单级兜底错误：没有字段路径的 issue 归一为 _form
const missing = new FormModel<{ items: string[] }>(formLevel, { items: [] });
const missingResult = missing.submit();
assert.equal(missingResult.ok, false);
assert.equal(missing.errors.items, "至少一项", "数组级错误挂在字段名 items 上");
assert.equal(missing.errorOf("items"), "至少一项", "提交过一次后，所有错误都可见");

console.log("✓ 131-01 Schema 解析、错误路径、touched/dirty 与错误可见性断言全部通过");
