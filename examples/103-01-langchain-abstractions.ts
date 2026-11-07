// 文件: examples/103-01-langchain-abstractions.ts
// 手写 LangChain 5 大核心抽象（Model / Retriever / Chain / Agent / Memory）的最小可运行实现
// 目标：用 TypeScript + node:assert 跑通完整链路，理解抽象层边界
// 断言：Chain 输出、Agent 循环、Memory 截断、Retriever 排序全部符合预期

import assert from "node:assert";

// ============================================================
// 1. Model 抽象：统一 LLM 调用接口
// ============================================================

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

interface ModelResponse {
  content: string;
  tool_calls?: Array<{ name: string; args: Record<string, any> }>;
}

class FakeChatModel {
  // 伪模型：根据用户输入决定是直接回复还是发起工具调用
  async invoke(messages: ChatMessage[]): Promise<ModelResponse> {
    const lastUser = messages.filter((m) => m.role === "user").pop();
    if (!lastUser) return { content: "你好！有什么可以帮你的？" };

    if (lastUser.content.includes("检索") || lastUser.content.includes("查") || lastUser.content.includes("搜索")) {
      return {
        content: "让我先检索一下相关资料。",
        tool_calls: [{ name: "search_knowledge", args: { query: lastUser.content } }],
      };
    }

    return { content: `关于「${lastUser.content.slice(0, 15)}」，这是一个很好的问题...` };
  }
}

// ============================================================
// 2. Retriever 抽象：统一检索接口
// ============================================================

interface Document {
  pageContent: string;
  metadata: { source: string; score?: number };
}

class KeywordRetriever {
  constructor(private docs: Document[]) {}

  async getRelevantDocuments(query: string, topK = 2): Promise<Document[]> {
    const keywords = query.toLowerCase().split(/[\s，。,！？!]+/).filter(Boolean);
    const scored = this.docs.map((doc) => {
      const hits = keywords.filter((kw) => doc.pageContent.toLowerCase().includes(kw)).length;
      return { doc, score: hits };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter((s) => s.score > 0)
      .map((s) => s.doc);
  }
}

// ============================================================
// 3. Chain 抽象：LCEL 风格的 pipe 组合
// ============================================================

type RunnableFn<I, O> = (input: I) => Promise<O>;

interface Runnable<I, O> {
  invoke(input: I): Promise<O>;
  pipe<Next>(next: RunnableFn<O, Next>): Runnable<I, Next>;
}

function runnable<I, O>(fn: RunnableFn<I, O>): Runnable<I, O> {
  return {
    invoke: fn,
    pipe<Next>(next: RunnableFn<O, Next>): Runnable<I, Next> {
      return runnable<I, Next>(async (input: I) => next(await fn(input)));
    },
  };
}

// ============================================================
// 4. Agent 抽象：ReAct 模式的工具调用循环
// ============================================================

interface Tool {
  name: string;
  description: string;
  invoke(args: Record<string, any>): Promise<string>;
}

class ReActAgent {
  private iteration = 0;

  constructor(
    private model: FakeChatModel,
    private tools: Tool[],
    private maxIterations = 5
  ) {}

  async run(userInput: string): Promise<string> {
    this.iteration = 0;
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `你是一个可以使用工具的 AI 助手。\n可用工具：\n${this.tools
          .map((t) => `- ${t.name}: ${t.description}`)
          .join("\n")}`,
      },
      { role: "user", content: userInput },
    ];

    while (this.iteration < this.maxIterations) {
      this.iteration++;
      const response = await this.model.invoke(messages);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        // 终止条件：LLM 直接给出最终回复
        return response.content;
      }

      // 执行工具调用
      for (const tc of response.tool_calls) {
        const tool = this.tools.find((t) => t.name === tc.name);
        if (!tool) {
          messages.push({ role: "tool", content: `错误：未找到工具 ${tc.name}` });
          continue;
        }
        const toolResult = await tool.invoke(tc.args);
        messages.push({ role: "tool", content: toolResult });
      }

      // 把 LLM 的中间回复也追加进上下文
      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls as any,
      });
    }

    return `已达到最大迭代次数（${this.maxIterations}），无法得出结论。`;
  }

  getIterationCount(): number {
    return this.iteration;
  }
}

// ============================================================
// 5. Memory 抽象：对话历史 + token 截断
// ============================================================

class BufferMemory {
  private messages: ChatMessage[] = [];

  constructor(private maxChars: number = 2000) {}

  addMessage(msg: ChatMessage) {
    this.messages.push(msg);
    this.trim();
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  clear() {
    this.messages = [];
  }

  private trim() {
    let total = this.messages.reduce((s, m) => s + m.content.length, 0);
    // 从最早的 system/user 消息开始砍（保留 system 消息）
    while (total > this.maxChars && this.messages.length > 1) {
      const idx = this.messages.findIndex((m) => m.role !== "system");
      if (idx === -1) break;
      const removed = this.messages.splice(idx, 1)[0];
      total -= removed.content.length;
    }
  }
}

// ============================================================
// 断言：完整链路测试
// ============================================================

async function runAllAssertions() {
  // 准备数据
  const model = new FakeChatModel();
  const docs: Document[] = [
    { pageContent: "LangChain 是一个用于构建 AI 应用的框架，提供 Model/Retriever/Chain/Agent/Memory 五大核心抽象。", metadata: { source: "wiki-langchain" } },
    { pageContent: "Dify 是一个低代码 AI 应用开发平台，提供可视化工作流编排、知识库管理和 API 一键发布。", metadata: { source: "wiki-dify" } },
    { pageContent: "RAG（Retrieval-Augmented Generation）是检索增强生成，结合检索和生成两种能力。", metadata: { source: "paper-rag" } },
    { pageContent: "Function Calling 让 LLM 可以结构化地调用外部工具，是 Agent 能力的基础。", metadata: { source: "blog-fc" } },
  ];
  const retriever = new KeywordRetriever(docs);

  // ---------- 测试 1：Retriever 排序 ----------
  const top2 = await retriever.getRelevantDocuments("LangChain 框架", 2);
  assert.ok(top2.length >= 1, "应至少检索到 1 个文档");
  assert.ok(top2[0].pageContent.includes("LangChain"), "Top1 应该是 LangChain 相关文档");
  console.log("[1/6] Retriever 排序 OK, Top1 =", top2[0].metadata.source);

  // ---------- 测试 2：Chain 管线 ----------
  const ragChain = runnable(async (query: string) => {
    const docs = await retriever.getRelevantDocuments(query, 3);
    return { query, context: docs.map((d) => d.pageContent).join("\n") };
  }).pipe(async ({ query, context }) => {
    const messages: ChatMessage[] = [
      { role: "system", content: `基于以下上下文回答用户问题：\n${context || "（无相关资料）"}` },
      { role: "user", content: query },
    ];
    const resp = await model.invoke(messages);
    return resp.content;
  });

  const chainResult = await ragChain.invoke("Dify 是什么平台");
  assert.ok(chainResult.length > 0, "Chain 应该输出非空字符串");
  console.log("[2/6] Chain RAG 管线 OK, 输出:", chainResult.slice(0, 40));

  // ---------- 测试 3：Agent ReAct 循环 ----------
  const tools: Tool[] = [
    {
      name: "search_knowledge",
      description: "在知识库中搜索相关文档",
      invoke: async ({ query }) => {
        const results = await retriever.getRelevantDocuments(String(query || ""), 3);
        return results.map((d) => `[${d.metadata.source}] ${d.pageContent}`).join("\n") || "未找到相关资料";
      },
    },
  ];

  const agent = new ReActAgent(model, tools, 5);
  const agentResult = await agent.run("帮我检索一下 LangChain 和 Dify 的资料");
  assert.ok(agentResult.length > 0, "Agent 应该输出结果");
  assert.ok(agent.getIterationCount() >= 1, "Agent 至少执行 1 次迭代");
  assert.ok(agent.getIterationCount() <= 5, "Agent 不超过 maxIterations 次");
  console.log("[3/6] Agent ReAct OK, 迭代次数:", agent.getIterationCount(), "输出:", agentResult.slice(0, 40));

  // ---------- 测试 4：Agent 不触发工具调用时直接回复 ----------
  const directAgent = new ReActAgent(model, tools, 5);
  const directResult = await directAgent.run("你好");
  assert.ok(directAgent.getIterationCount() === 1, "不触发工具时应该 1 次迭代就终止");
  console.log("[4/6] Agent 直接回复 OK, 迭代次数:", directAgent.getIterationCount());

  // ---------- 测试 5：Memory 截断 ----------
  const memory = new BufferMemory(50); // 小 maxChars 触发截断
  memory.addMessage({ role: "system", content: "你是 AI 助手" });
  memory.addMessage({ role: "user", content: "A".repeat(30) });
  memory.addMessage({ role: "assistant", content: "B".repeat(30) });
  memory.addMessage({ role: "user", content: "C".repeat(30) }); // 这一条应该触发截断
  const msgs = memory.getMessages();
  const systemCount = msgs.filter((m) => m.role === "system").length;
  assert.ok(systemCount === 1, "System 消息应该被保留");
  assert.ok(msgs.length <= 3, "应该已截断到合理数量");
  console.log("[5/6] Memory 截断 OK, 保留消息数:", msgs.length, ", system 保留:", systemCount === 1);

  // ---------- 测试 6：Chain 的 pipe 语义 ----------
  const doublePipe = runnable(async (x: number) => x * 2).pipe(async (x) => x + 3);
  const v = await doublePipe.invoke(5);
  assert.equal(v, 13, "5 * 2 + 3 = 13");
  console.log("[6/6] LCEL pipe 组合 OK, 5 →", v);

  console.log("\n✅ 103-01 LangChain 5 大核心抽象 全部断言通过");
}

runAllAssertions().catch((e) => {
  console.error("断言失败:", e.message);
  process.exit(1);
});
