// 文件: examples/131-04-submit-orchestration.ts
// 131.6 多步向导与提交编排：分步校验、幂等键、并发提交合并、服务端 422 映射。
// 纯 TS + zod@3.25，npx tsx 实跑。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// ---------------- 1) 分步 Schema：每步只校验自己的字段 ----------------
const StepSchemas = [
  z.object({
    email: z.string().trim().email("邮箱格式不正确"),
  }),
  z.object({
    company: z.string().trim().min(2, "公司名至少 2 个字符"),
  }),
  z.object({
    plan: z.enum(["free", "pro"]),
    coupon: z.string().trim().default(""),
  }),
] as const;

const FullSchema = StepSchemas[0].merge(StepSchemas[1]).merge(StepSchemas[2]);
type FormValues = z.input<typeof FullSchema>;

interface StepError {
  path: string;
  message: string;
}

function validateStep(index: number, values: Partial<FormValues>): StepError[] {
  const schema = StepSchemas[index];
  const parsed = schema.safeParse(values);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    path: issue.path.join(".") || "_form",
    message: issue.message,
  }));
}

// ---------------- 2) 向导：分步推进 + 回退保留值 ----------------
export class Wizard {
  step = 0;
  errors: Record<string, string> = {};
  values: Partial<FormValues> = { email: "", company: "", plan: "free" };

  get canGoBack(): boolean {
    return this.step > 0;
  }

  setValue(name: string, value: unknown): void {
    (this.values as Record<string, unknown>)[name] = value;
    delete this.errors[name];
  }

  /** 当前步通过才允许进入下一步；失败时错误按字段归集 */
  next(): boolean {
    const issues = validateStep(this.step, this.values);
    if (issues.length > 0) {
      this.errors = Object.fromEntries(issues.map((i) => [i.path, i.message]));
      return false;
    }
    this.errors = {};
    if (this.step < StepSchemas.length - 1) this.step += 1;
    return true;
  }

  back(): void {
    if (!this.canGoBack) return;
    this.step -= 1;
    this.errors = {}; // 回退时清空当前步错误，但值保留
  }

  /** 最后一步才做全量校验：分步校验会漏掉跨字段规则 */
  validateAll(): StepError[] {
    const parsed = FullSchema.safeParse(this.values);
    if (parsed.success) return [];
    return parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "_form",
      message: issue.message,
    }));
  }
}

// ---------------- 3) 提交控制器：单飞、幂等、错误映射 ----------------
interface FieldError {
  path: string;
  message: string;
}

export class HttpFieldError extends Error {
  constructor(
    readonly status: number,
    readonly fields: FieldError[],
  ) {
    super(`HTTP ${status}`);
  }
}

export class NetworkError extends Error {}

export type SubmitState = "idle" | "submitting" | "success" | "error";

interface SubmitResult {
  ok: boolean;
  state: SubmitState;
  errors: Record<string, string>;
}

export class SubmitController {
  state: SubmitState = "idle";
  errors: Record<string, string> = {};
  #inflight: Promise<SubmitResult> | null = null;
  #idempotencyKey = randomUUID();
  readonly keysUsed: string[] = [];

  constructor(
    private readonly transport: (payload: {
      idempotencyKey: string;
      values: unknown;
    }) => Promise<void>,
  ) {}

  get idempotencyKey(): string {
    return this.#idempotencyKey;
  }

  submit(values: unknown): Promise<SubmitResult> {
    // 双击/回车连按：直接复用同一个在途 Promise，不重复下单
    if (this.#inflight) return this.#inflight;
    this.state = "submitting";
    this.keysUsed.push(this.#idempotencyKey);
    this.#inflight = this.#run(values).finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  async #run(values: unknown): Promise<SubmitResult> {
    try {
      await this.transport({ idempotencyKey: this.#idempotencyKey, values });
      this.state = "success";
      this.errors = {};
      // 成功后换新键：下一次提交是「新意图」，不能复用旧键
      this.#idempotencyKey = randomUUID();
      return { ok: true, state: this.state, errors: {} };
    } catch (error) {
      if (error instanceof HttpFieldError) {
        // 可定位到字段的业务错误：展示错误，并换键（用户会改值再提交）
        this.state = "error";
        this.errors = Object.fromEntries(error.fields.map((f) => [f.path, f.message]));
        this.#idempotencyKey = randomUUID();
        return { ok: false, state: this.state, errors: this.errors };
      }
      if (error instanceof NetworkError) {
        // 网络/5xx：保留幂等键，重试仍然安全
        this.state = "error";
        this.errors = { _form: "网络异常，请重试" };
        return { ok: false, state: this.state, errors: this.errors };
      }
      throw error;
    }
  }
}

// ---------------- 断言 ----------------
// 1) 分步校验：第 1 步不通过时无法前进
const wizard = new Wizard();
assert.equal(wizard.next(), false);
assert.equal(wizard.errors.email, "邮箱格式不正确");
assert.equal(wizard.step, 0);

wizard.setValue("email", "alice@example.com");
assert.equal(wizard.errors.email, undefined, "改值即清掉该字段错误");
assert.equal(wizard.next(), true);
assert.equal(wizard.step, 1);

// 2) 回退保留已填值，再前进不丢
wizard.back();
assert.equal(wizard.values.email, "alice@example.com");
assert.equal(wizard.next(), true);

// 3) 第 2 步校验与「最后一步才做全量校验」
assert.equal(wizard.next(), false);
assert.equal(wizard.errors.company, "公司名至少 2 个字符");
wizard.setValue("company", "Acme");
assert.equal(wizard.next(), true);
assert.equal(wizard.step, 2);
assert.deepEqual(wizard.validateAll(), [], "全部字段合法");

// 4) 提交：网络失败保留幂等键，重试成功后才换键
const calls: { idempotencyKey: string; values: unknown }[] = [];
let attempts = 0;
const controller = new SubmitController(async (payload) => {
  calls.push(payload);
  attempts += 1;
  if (attempts === 1) throw new NetworkError("socket hang up");
});

const firstKey = controller.idempotencyKey;
const firstResult = await controller.submit({ email: "alice@example.com" });
assert.equal(firstResult.ok, false);
assert.equal(controller.state, "error");
assert.equal(controller.errors._form, "网络异常，请重试");
assert.equal(controller.idempotencyKey, firstKey, "网络失败不换键，重试才幂等");

const retryResult = await controller.submit({ email: "alice@example.com" });
assert.equal(retryResult.ok, true);
assert.equal(controller.state, "success");
assert.equal(calls[0]?.idempotencyKey, calls[1]?.idempotencyKey, "两次请求同一幂等键");
assert.notEqual(controller.idempotencyKey, firstKey, "成功后换新键");

// 5) 并发提交合并：双击只发一次请求
const concurrentCalls: string[] = [];
const slow = new SubmitController(async (payload) => {
  concurrentCalls.push(payload.idempotencyKey);
  await new Promise((resolve) => setTimeout(resolve, 10));
});
const p1 = slow.submit({ email: "a@b.com" });
const p2 = slow.submit({ email: "a@b.com" });
assert.equal(p1, p2, "同一在途 Promise，双击不会重复下单");
await Promise.all([p1, p2]);
assert.equal(concurrentCalls.length, 1);

// 6) 服务端 422：按字段映射，并换键（用户改值后是新意图）
const fieldCalls: string[] = [];
const fieldController = new SubmitController(async (payload) => {
  fieldCalls.push(payload.idempotencyKey);
  throw new HttpFieldError(422, [{ path: "company", message: "公司名已被占用" }]);
});
const beforeKey = fieldController.idempotencyKey;
const fieldResult = await fieldController.submit({ company: "Acme" });
assert.equal(fieldResult.ok, false);
assert.equal(fieldController.errors.company, "公司名已被占用");
assert.equal(fieldController.state, "error");
assert.notEqual(fieldController.idempotencyKey, beforeKey, "字段错误后换键");

// 7) 全量 Schema 合并后仍能捕获跨步字段缺失
const incomplete = FullSchema.safeParse({ email: "a@b.com" });
assert.equal(incomplete.success, false);
if (!incomplete.success) {
  assert.deepEqual(
    incomplete.error.issues.map((i) => i.path.join(".")),
    ["company", "plan"],
    "合并 schema 一次报出所有缺失字段",
  );
}

console.log("✓ 131-04 分步校验、向导回退、幂等提交与 422 映射断言全部通过");
