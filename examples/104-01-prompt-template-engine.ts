// 文件: examples/104-01-prompt-template-engine.ts
// 系统提示词模板引擎：角色 + 约束 + 输出契约三段式构建
// 支持变量插值、Few-shot 示例注入、版本标记

import assert from "node:assert";

interface PromptRole {
  name: string;
  expertise: string[];
  background?: string;
}

interface PromptCapability {
  can: string[];
  cannot: string[];
  fallback: string;
}

interface PromptConstraint {
  style: "concise" | "detailed" | "formal" | "casual";
  language: "zh" | "en";
  mustIncludeCode?: boolean;
  codeMaxLines?: number;
}

interface OutputContract {
  format: "json" | "markdown" | "plaintext";
  schema?: Record<string, any>;
  template?: string;
}

interface SystemPromptConfig {
  role: PromptRole;
  capability: PromptCapability;
  constraint: PromptConstraint;
  output: OutputContract;
  version?: string;
  examples?: Array<{ input: string; output: string }>;
}

class PromptTemplateEngine {
  constructor(private config: SystemPromptConfig) {}

  build(): string {
    const sections: string[] = [];
    const r = this.config.role;
    sections.push(
      `# Role\n你是「${r.name}」，一名 ${r.expertise.join(" / ")} 专家。` +
      (r.background ? `\n背景：${r.background}` : "")
    );

    const cap = this.config.capability;
    sections.push(
      `# Capability\n- 能做：${cap.can.join("、")}\n- 不能做：${cap.cannot.join("、")}\n- 遇到不能做的事：${cap.fallback}`
    );

    const c = this.config.constraint;
    const constraints: string[] = [];
    if (c.style === "concise") constraints.push("回答保持简洁，直击要点");
    if (c.mustIncludeCode) constraints.push("必须提供代码示例");
    if (c.codeMaxLines) constraints.push(`单个代码块不超过 ${c.codeMaxLines} 行`);
    sections.push(`# Constraints\n${constraints.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);

    const out = this.config.output;
    if (out.format === "json" && out.schema) {
      sections.push(
        `# Output Format\n**必须**输出符合以下 JSON Schema 的对象：\n\`\`\`json\n${JSON.stringify(out.schema, null, 2)}\n\`\`\``
      );
    }

    if (this.config.version) sections.push(`# Version\n当前提示词版本：${this.config.version}`);
    if (this.config.examples && this.config.examples.length > 0) {
      sections.push(
        `# Few-shot Examples\n${this.config.examples
          .map((ex, i) => `示例 ${i + 1}:\n输入: ${ex.input}\n输出: ${ex.output}`)
          .join("\n\n")}`
      );
    }

    return sections.join("\n\n");
  }

  buildUserMessage(template: string, vars: Record<string, string | number>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value));
    }
    return result;
  }
}

async function runAssertions() {
  // 测试 1：基础角色提示词
  const engine = new PromptTemplateEngine({
    role: { name: "Frontend Reviewer Copilot", expertise: ["Vue 3", "TypeScript", "性能优化"] },
    capability: {
      can: ["审查代码", "给出修复建议"],
      cannot: ["运行代码", "访问外部 API"],
      fallback: "我只能基于静态代码分析",
    },
    constraint: { style: "concise", language: "zh", mustIncludeCode: true, codeMaxLines: 30 },
    output: {
      format: "json",
      schema: {
        type: "object",
        properties: {
          issues: { type: "array" },
          suggestions: { type: "array" },
        },
        required: ["issues", "suggestions"],
      },
    },
    version: "1.2.0",
  });

  const sp = engine.build();
  assert.ok(sp.includes("Frontend Reviewer Copilot"));
  assert.ok(sp.includes("Vue 3"));
  assert.ok(sp.includes("不能做：运行代码"));
  assert.ok(sp.includes("Version\n当前提示词版本：1.2.0"));
  console.log("[1/4] 基础提示词 OK, 长度:", sp.length);

  // 测试 2：用户消息变量插值
  const msg = engine.buildUserMessage(
    "请审查以下 {{framework}} 组件（{{lines}} 行）：\n```ts\n{{code}}\n```",
    { framework: "Vue 3", lines: 15, code: "const x = ref(0);" }
  );
  assert.ok(msg.includes("Vue 3"));
  assert.ok(msg.includes("15"));
  console.log("[2/4] 变量插值 OK");

  // 测试 3：Few-shot 注入
  const engine2 = new PromptTemplateEngine({
    role: { name: "Code Classifier", expertise: ["代码分类"] },
    capability: { can: ["分类"], cannot: [], fallback: "不知道" },
    constraint: { style: "concise", language: "zh" },
    output: { format: "plaintext" },
    examples: [
      { input: "const x = ref(0);", output: "Vue 3 Composition API" },
      { input: "import { useState } from 'react'", output: "React Hooks" },
      { input: "class MyMixin extends Mixin {}", output: "Vue 2 Mixin" },
    ],
  });
  const p2 = engine2.build();
  assert.ok(p2.includes("示例 1"));
  assert.ok(p2.includes("Vue 3 Composition API"));
  assert.ok(p2.includes("示例 3"));
  console.log("[3/4] Few-shot 注入 OK, 3 个示例");

  // 测试 4：空数组能力边界
  const engine3 = new PromptTemplateEngine({
    role: { name: "Simple Bot", expertise: ["客服"] },
    capability: { can: ["回答问题"], cannot: ["做决策"], fallback: "请咨询人工" },
    constraint: { style: "concise", language: "zh" },
    output: { format: "plaintext" },
  });
  const p3 = engine3.build();
  assert.ok(p3.includes("不能做：做决策"));
  console.log("[4/4] 能力边界 OK");

  console.log("\n✅ 104-01 提示词模板引擎 全部断言通过");
}

runAssertions().catch((e) => {
  console.error("断言失败:", e.message);
  process.exit(1);
});
