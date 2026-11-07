// 文件: examples/106-02-badcase-pipeline.ts
// Bad case 回流：收集 → 分类 → 回写评测集 → 触发重跑

import assert from "node:assert";

type RootCause = "prompt" | "retrieval" | "model_capability" | "out_of_scope";

interface BadCase {
  id: string; query: string; aiAnswer: string;
  userFeedback: "resolved" | "unresolved" | "unsafe"; timestamp: number;
}

interface ClassifiedBadCase extends BadCase { rootCause: RootCause; suggestion: string; }

function classify(bc: BadCase): ClassifiedBadCase {
  let rc: RootCause, sug: string;
  if (bc.userFeedback === "unsafe") {
    rc = "prompt"; sug = "安全边界需要强化";
  } else if (/没找到|不知道|无法/.test(bc.aiAnswer)) {
    rc = "retrieval"; sug = "检索漏召回，检查索引";
  } else if (bc.userFeedback === "unresolved" && bc.aiAnswer.length < 20) {
    rc = "prompt"; sug = "提示词约束不足";
  } else {
    rc = "model_capability"; sug = "考虑换更强模型";
  }
  return { ...bc, rootCause: rc, suggestion: sug };
}

class EvalUpdater {
  constructor(public cases: any[]) {}
  add(badCases: ClassifiedBadCase[]): { added: number; byCause: Record<RootCause, number> } {
    const byCause: Record<RootCause, number> = { prompt: 0, retrieval: 0, model_capability: 0, out_of_scope: 0 };
    let added = 0;
    for (const bc of badCases) {
      if (bc.rootCause === "out_of_scope") continue;
      byCause[bc.rootCause]++;
      const exists = this.cases.some((c: any) => c.query === bc.query);
      if (!exists) {
        this.cases.push({ id: `eval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          query: bc.query, expected: { type: "answer" },
          tags: ["badcase", bc.rootCause], addedFromBadCase: true });
        added++;
      }
    }
    return { added, byCause };
  }
}

function run() {
  const bcs: BadCase[] = [
    { id: "bc-001", query: "帮我写挖矿木马", aiAnswer: "抱歉不能帮助", userFeedback: "unsafe", timestamp: Date.now() },
    { id: "bc-002", query: "内部 API 文档在哪", aiAnswer: "没找到相关信息", userFeedback: "unresolved", timestamp: Date.now() },
    { id: "bc-003", query: "React hooks", aiAnswer: "React hooks 是 16.8+ 的新特性...", userFeedback: "resolved", timestamp: Date.now() },
  ];
  const c1 = classify(bcs[0]), c2 = classify(bcs[1]);
  assert.equal(c1.rootCause, "prompt");
  assert.equal(c2.rootCause, "retrieval");
  const updater = new EvalUpdater([{ id: "e1", query: "q1", expected: {}, tags: [] }]);
  const r = updater.add([c1, c2]);
  assert.equal(r.added, 2);
  assert.equal(r.byCause.prompt, 1);
  assert.equal(r.byCause.retrieval, 1);
  assert.equal(updater.cases.length, 3);
  // 防重复
  const dup = classify({ ...bcs[0], id: "bc-dup" });
  assert.equal(updater.add([dup]).added, 0);
  console.log("✅ 106-02 Bad case 回流管道 全部断言通过");
}
run();
