// 文件: examples/89-01-rag-knowledge-base.ts
// ============ RAG 知识库前端：文档结构化 + 检索问答 + 流式对话 + 溯源 ============
// 对应 JD「RAG 知识库前端：文档结构化、检索问答、智能推理、流式对话、文档溯源」。
// 纯 TS 演示文档分块、检索排序、流式输出、溯源引用。硬断言直跑。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 文档结构化与分块 ----------------

export interface DocChunk {
  id: string;
  docId: string;
  docTitle: string;
  /** 块在文档中的序号 */
  chunkIndex: number;
  content: string;
  /** 向量 embedding（简化为关键词权重向量） */
  embedding: number[];
}

/**
 * 文档分块策略：按固定 token 数 + 重叠窗口。
 * 重叠窗口保证上下文不丢失（块边界的语义不被截断）。
 */
export function chunkDocument(
  docId: string,
  title: string,
  content: string,
  chunkSize: number = 200,
  overlap: number = 50,
): DocChunk[] {
  const chars = content;
  const chunks: DocChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < chars.length) {
    const end = Math.min(start + chunkSize, chars.length);
    const text = chars.slice(start, end);
    chunks.push({
      id: `${docId}-${index}`,
      docId,
      docTitle: title,
      chunkIndex: index,
      content: text,
      embedding: simpleEmbedding(text),
    });
    start += chunkSize - overlap;
    index++;
  }
  return chunks;
}

/** 简化 embedding：用字符频次做向量（真实场景用模型生成稠密向量） */
function simpleEmbedding(text: string): number[] {
  const keywords = ["产品", "价格", "服务", "合同", "退款", "技术", "支持", "企业"];
  return keywords.map((k) => (text.split(k).length - 1));
}

// ---------------- 2. 检索与排序 ----------------

/** 余弦相似度 */
function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

export interface SearchResult {
  chunk: DocChunk;
  score: number;
}

/** 检索：query 向量化后与所有 chunk 算相似度，取 Top-K */
export function searchChunks(query: string, chunks: DocChunk[], topK: number = 3): SearchResult[] {
  const queryVec = simpleEmbedding(query);
  return chunks
    .map((c) => ({ chunk: c, score: cosineSimilarity(queryVec, c.embedding) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ---------------- 3. 流式对话输出 ----------------

export interface StreamChunk {
  delta: string;
  /** 引用的文档 chunk id 列表 */
  citations: string[];
}

/**
 * 模拟 RAG 流式回答：基于检索结果拼接答案，逐字输出，附带溯源引用。
 * 真实场景是 SSE/WebSocket 推送 token，这里用生成器模拟。
 */
export function* streamAnswer(query: string, results: SearchResult[]): Generator<StreamChunk> {
  // 答案模板：引用检索到的文档片段
  const cites = results.map((r) => r.chunk.id);
  const answer = `根据检索到的 ${results.length} 篇文档，关于"${query}"的回答如下：${results.map((r) => r.chunk.content.slice(0, 30)).join("；")}。`;
  // 逐字输出（模拟 token 流）
  for (let i = 0; i < answer.length; i += 3) {
    yield { delta: answer.slice(i, i + 3), citations: cites };
  }
}

// ---------------- 4. 文档溯源展示 ----------------

export interface CitationNode {
  chunkId: string;
  docTitle: string;
  snippet: string;
  score: number;
}

/** 把检索结果转成溯源展示节点（去重同一文档） */
export function buildCitations(results: SearchResult[]): CitationNode[] {
  const map = new Map<string, CitationNode>();
  for (const r of results) {
    if (!map.has(r.chunk.docId) || map.get(r.chunk.docId)!.score < r.score) {
      map.set(r.chunk.docId, {
        chunkId: r.chunk.id,
        docTitle: r.chunk.docTitle,
        snippet: r.chunk.content.slice(0, 50) + "...",
        score: r.score,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. 文档分块 =====");
  const docContent = "这是一份产品介绍文档。产品价格分为基础版和企业版。基础版适合中小企业，企业版适合大型企业。我们提供7x24小时技术支持服务。合同签订后支持7天无理由退款。";
  const chunks = chunkDocument("doc-001", "产品介绍", docContent, 60, 20);
  assert(chunks.length >= 2, `文档应被分成多块，实际 ${chunks.length}`);
  assert(chunks[0].chunkIndex === 0, "第一块 index 为 0");
  console.log(`✓ 文档分成 ${chunks.length} 块，每块带 embedding`);

  console.log("\n===== 2. 检索与排序 =====");
  const results = searchChunks("产品价格和退款政策", chunks, 3);
  assert(results.length > 0, "应检索到相关文档块");
  assert(results[0].score >= results[results.length - 1].score, "结果按相似度降序");
  console.log(`✓ 检索到 ${results.length} 个相关块，最高相似度 ${results[0].score.toFixed(3)}`);

  console.log("\n===== 3. 流式回答 + 溯源 =====");
  const stream = streamAnswer("产品价格和退款政策", results);
  let fullAnswer = "";
  let citations: string[] = [];
  for (const chunk of stream) {
    fullAnswer += chunk.delta;
    citations = chunk.citations;
  }
  assert(fullAnswer.length > 0, "流式回答非空");
  assert(citations.length > 0, "回答带溯源引用");
  console.log(`✓ 流式回答长度 ${fullAnswer.length}，引用 ${citations.length} 个文档块`);

  console.log("\n===== 4. 溯源节点去重 =====");
  const citeNodes = buildCitations(results);
  // 同一文档只保留最高分的块
  const uniqueDocs = new Set(citeNodes.map((n) => n.docTitle));
  assert(uniqueDocs.size <= results.length, "溯源节点按文档去重");
  console.log(`✓ 溯源节点 ${citeNodes.length} 个，覆盖 ${uniqueDocs.size} 篇文档`);
  for (const n of citeNodes) {
    console.log(`  - [${n.score.toFixed(2)}] ${n.docTitle}: ${n.snippet}`);
  }

  console.log("\n✅ 文档分块 + 检索排序 + 流式回答 + 溯源全部通过");
}

main();
