// 文件: examples/104-02-structured-output-retry.ts
// 结构化输出：JSON Schema 校验 + 自动重试 + 错误反馈
// 目标：模拟 LLM 输出 JSON → 校验失败 → 把错误喂回 LLM → 重试成功
// 衔接 33 册 Zod（本示例用 Zod 做 JSON 校验器）

import assert from "node:assert";

// ============================================================
// 1. 定义输出 Schema（用 Zod 做运行时校验）
// ============================================================

interface ReviewIssue {
  severity: "high" | "medium" | "low";
  title: string;
  line?: number;
  suggestion: string;
}

interface ReviewOutput {
  summary: string;
  issues: ReviewIssue[];
  score: number; // 0-100
}

// 简化版 Zod-like 校验器（避免第三方依赖）
type Validator<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: ValidationError };
};

class ValidationError extends Error {
  constructor(public issues: Array<{ path: string; message: string }>) {
    super(`校验失败：${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    this.name = "ValidationError";
  }
}

function object<T extends Record<string, Validator<any>>>(shape: T) {
  return {
    safeParse(input: unknown): { success: true; data: Record<string, any> } | { success: false; error: ValidationError } {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return { success: false, error: new ValidationError([{ path: "$", message: "必须是对象" }]) };
      }
      const issues: Array<{ path: string; message: string }> = [];
      const data: Record<string, any> = {};
      for (const [key, validator] of Object.entries(shape)) {
        const result = validator.safeParse((input as any)[key]);
        if (result.success) {
          data[key] = result.data;
        } else {
          for (const issue of result.error.issues) {
            issues.push({ path: `${key}.${issue.path}`, message: issue.message });
          }
        }
      }
      return issues.length > 0
        ? { success: false, error: new ValidationError(issues) }
        : { success: true, data };
    },
  };
}

function string(opts?: { min?: number; max?: number; pattern?: RegExp }) {
  return {
    safeParse(input: unknown): { success: true; data: string } | { success: false; error: ValidationError } {
      if (typeof input !== "string") {
        return { success: false, error: new ValidationError([{ path: "", message: "必须是字符串" }]) };
      }
      const issues: Array<{ path: string; message: string }> = [];
      if (opts?.min !== undefined && input.length < opts.min) {
        issues.push({ path: "", message: `最少 ${opts.min} 字符` });
      }
      if (opts?.max !== undefined && input.length > opts.max) {
        issues.push({ path: "", message: `最多 ${opts.max} 字符` });
      }
      if (opts?.pattern && !opts.pattern.test(input)) {
        issues.push({ path: "", message: `不符合模式 ${opts.pattern}` });
      }
      return issues.length > 0
        ? { success: false, error: new ValidationError(issues) }
        : { success: true, data: input };
    },
  };
}

function number(opts?: { min?: number; max?: number }) {
  return {
    safeParse(input: unknown): { success: true; data: number } | { success: false; error: ValidationError } {
      if (typeof input !== "number" || Number.isNaN(input)) {
        return { success: false, error: new ValidationError([{ path: "", message: "必须是数字" }]) };
      }
      const issues: Array<{ path: string; message: string }> = [];
      if (opts?.min !== undefined && input < opts.min) issues.push({ path: "", message: `≥ ${opts.min}` });
      if (opts?.max !== undefined && input > opts.max) issues.push({ path: "", message: `≤ ${opts.max}` });
      return issues.length > 0
        ? { success: false, error: new ValidationError(issues) }
        : { success: true, data: input };
    },
  };
}

function array<T>(itemValidator: Validator<T>, opts?: { min?: number }) {
  return {
    safeParse(input: unknown): { success: true; data: T[] } | { success: false; error: ValidationError } {
      if (!Array.isArray(input)) {
        return { success: false, error: new ValidationError([{ path: "", message: "必须是数组" }]) };
      }
      const issues: Array<{ path: string; message: string }> = [];
      if (opts?.min !== undefined && input.length < opts.min) {
        issues.push({ path: "", message: `至少 ${opts.min} 项` });
      }
      for (let i = 0; i < input.length; i++) {
        const result = itemValidator.safeParse(input[i]);
        if (!result.success) {
          for (const issue of result.error.issues) {
            issues.push({ path: `[${i}]${issue.path}`, message: issue.message });
          }
        }
      }
      return issues.length > 0
        ? { success: false, error: new ValidationError(issues) }
        : { success: true, data: input as T[] };
    },
  };
}

function optional<T>(v: Validator<T>) {
  return {
    safeParse(input: unknown) {
      if (input === undefined) return { success: true as const, data: undefined as any };
      return v.safeParse(input);
    },
  };
}

// ReviewOutput 的完整 Schema
const issueSchema = object({
  severity: string({ pattern: /^(high|medium|low)$/ }),
  title: string({ min: 1, max: 100 }),
  line: optional(number({ min: 1 })),
  suggestion: string({ min: 5 }),
});

const reviewSchema = object({
  summary: string({ min: 5, max: 500 }),
  issues: array(issueSchema, { min: 1 }),
  score: number({ min: 0, max: 100 }),
});

// ============================================================
// 2. 模拟 LLM + 校验 + 重试循环
// ============================================================

interface FakeLLMResponse {
  json: string;
}

// 模拟 LLM：根据轮次返回不同质量的 JSON
class FakeLLM {
  private round = 0;

  async generate(messages: Array<{ role: string; content: string }>): Promise<FakeLLMResponse> {
    this.round++;

    if (this.round === 1) {
      // 第一次：故意输出坏 JSON（issues 是字符串不是数组 + score 超范围）
      return {
        json: JSON.stringify({
          summary: "代码整体尚可，但有几个小问题。",
          issues: "不是数组而是字符串",
          score: 150, // 超范围
        }),
      };
    } else if (this.round === 2) {
      // 第二次：部分修复（issues 是数组了，但 severity 是 "critical" 不在枚举里）
      return {
        json: JSON.stringify({
          summary: "代码有改进空间。",
          issues: [
            { severity: "critical", title: "循环依赖", suggestion: "解耦模块" },
          ],
          score: 85,
        }),
      };
    } else {
      // 第三次：完全正确
      return {
        json: JSON.stringify({
          summary: "整体代码质量良好，有 2 个改进点。",
          issues: [
            { severity: "medium", title: "循环依赖风险", line: 15, suggestion: "用接口抽离解耦" },
            { severity: "low", title: "命名不规范", line: 28, suggestion: "变量名改用 camelCase" },
          ],
          score: 88,
        }),
      };
    }
  }
}

interface ExtractionResult<T> {
  data: T;
  attempts: number;
  errors: string[];
}

/**
 * 结构化输出提取器：LLM → JSON.parse → Schema 校验 → 重试
 */
async function extractStructured<T>(
  llm: FakeLLM,
  schema: Validator<T>,
  systemPrompt: string,
  userMessage: string,
  maxRetries = 3
): Promise<ExtractionResult<T>> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const errors: string[] = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await llm.generate(messages);

    // Step 1: JSON.parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.json);
    } catch (e: any) {
      const err = `JSON 解析失败: ${e.message}`;
      errors.push(err);
      messages.push({ role: "assistant", content: response.json });
      messages.push({
        role: "user",
        content: `上一次的输出不是合法 JSON。请只输出合法 JSON 对象，不要包含解释文字。`,
      });
      continue;
    }

    // Step 2: Schema 校验
    const result = schema.safeParse(parsed);
    if (result.success) {
      return { data: result.data, attempts: attempt, errors };
    }

    // Step 3: 校验失败，把错误喂回 LLM 重试
    errors.push(result.error.message);
    messages.push({ role: "assistant", content: response.json });
    messages.push({
      role: "user",
      content: `上一次的 JSON 输出有以下校验错误：\n${result.error.message}\n\n请修复这些问题后重新输出完整的 JSON 对象。`,
    });
  }

  throw new Error(`超过最大重试次数 (${maxRetries})。\n错误历史：\n${errors.join("\n")}`);
}

// ============================================================
// 断言验证
// ============================================================

async function runAssertions() {
  const llm = new FakeLLM();
  const systemPrompt = `你是一个代码审查助手。输出必须是符合以下 JSON Schema 的对象：
${JSON.stringify({
  type: "object",
  properties: {
    summary: { type: "string", description: "一句话总结" },
    issues: { type: "array", items: { type: "object" } },
    score: { type: "number", minimum: 0, maximum: 100 },
  },
})}
只输出 JSON，不要其他内容。`;

  const result = await extractStructured<ReviewOutput>(
    llm,
    reviewSchema,
    systemPrompt,
    "审查以下代码片段",
    3
  );

  // ---------- 测试 1：最终成功 ----------
  assert.ok(result.data.summary.length > 0, "summary 有值");
  assert.ok(result.data.issues.length >= 1, "issues 至少 1 条");
  assert.ok(result.data.score >= 0 && result.data.score <= 100, "score 在 0-100 范围");
  console.log("[1/3] 最终输出有效, score:", result.data.score, "issues:", result.data.issues.length);

  // ---------- 测试 2：重试次数 ----------
  assert.equal(result.attempts, 3, "应该经过 3 轮才成功");
  console.log("[2/3] 重试次数:", result.attempts, "（预期 3）");

  // ---------- 测试 3：错误历史 ----------
  assert.ok(result.errors.length === 2, "前两轮应该各有一个错误");
  assert.ok(result.errors[0].includes("issues"), "第一个错误应该指向 issues 字段");
  console.log("[3/3] 错误历史:", result.errors.length, "条");

  console.log("\n✅ 104-02 结构化输出 + 校验重试 全部断言通过");
}

runAssertions().catch((e) => {
  console.error("断言失败:", e.message);
  process.exit(1);
});
