/**
 * 第 102 部分 · Element Plus 企业实战
 * 重复 v-for 检测器：模板结构 → DOM 异常根因定位
 * 经验 recall（1093003）："间距不对/挤成一行/布局怪" 先查模板结构再调样式
 * 运行：npx tsx examples/102-05-duplicate-v-for-detector.ts
 */
import assert from "node:assert";

interface DetectorFinding {
  kind: "duplicate-v-for" | "sibling-same-attr" | "missing-close-tag";
  line: number;
  snippet: string;
  description: string;
  severity: "error" | "warning";
  fix?: string;
}

/**
 * 扫描 Vue template 中的模板结构异常：
 *   - 连续同级出现多个 v-for（重复渲染、DOM 结构混乱）
 *   - 同级节点出现相同 class 且都带 v-for（可能是复制粘贴残留）
 *   - 疑似缺失闭合标签（简单计数：< 与 </ 不平衡）
 */
export function detectDuplicateVFor(template: string): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  // 统一 trimEnd 行尾空白（\r、多余空格），避免缩进匹配被干扰
  const cleanedLines = template.split("\n").map((l) => l.trimEnd());

  // ---------- 1. 同一父容器内重复 v-for ----------
  // 改用 (indent, target) 分组 Map：同一缩进级 = 同一父容器，
  // 只要在同一缩进级内出现两次相同 target 就判定为重复（不管中间隔多少行）
  const seenAt = new Map<string, number>(); // `${indent}|${target}` → 首次出现行号
  cleanedLines.forEach((line, i) => {
    const vforMatch = line.match(/v-for\s*=\s*"([^"]+)"|v-for='([^']+)'/);
    if (!vforMatch) return;
    const target = (vforMatch[1] ?? vforMatch[2] ?? "").trim();
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const key = `${indent}|${target}`;
    if (seenAt.has(key)) {
      findings.push({
        kind: "duplicate-v-for",
        line: i + 1,
        snippet: line.trim(),
        description: `同缩进（${indent}）同目标（${target}）的 v-for 在 L${seenAt.get(key)} 和 L${i + 1} 重复出现`,
        severity: "error",
        fix: "删除重复块，合并为单一 v-for；如果确实需要多组不同数据，改用不同数据源或嵌套 template",
      });
    } else {
      seenAt.set(key, i + 1);
    }
  });

  // ---------- 2. 多行同容器拼接多个 v-for（间距混乱的另一根因） ----------
  const groups = new Map<number, string[]>();
  cleanedLines.forEach((line) => {
    const vforMatch = line.match(/v-for\s*=\s*"([^"]+)"|v-for='([^']+)'/);
    if (!vforMatch) return;
    const target = (vforMatch[1] ?? vforMatch[2] ?? "").trim();
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (!groups.has(indent)) groups.set(indent, []);
    groups.get(indent)!.push(target);
  });
  for (const [indent, targets] of groups) {
    const unique = new Set(targets);
    if (unique.size >= 3) {
      const firstLine = cleanedLines.findIndex(
        (l) => l.match(/v-for/) && (l.match(/^\s*/)?.[0].length ?? 0) === indent,
      ) + 1;
      findings.push({
        kind: "duplicate-v-for",
        line: firstLine,
        snippet: [...unique].join("; "),
        description: `缩进 ${indent} 级存在 ${unique.size} 个不同 v-for 目标（疑似同一容器内拼接多个循环块，导致间距/布局混乱）`,
        severity: "warning",
        fix: "把多组不同数据源统一为一个计算属性数组 + 单一 v-for，或分别包在独立容器中",
      });
    }
  }

  // ---------- 3. 疑似缺失闭合标签 ----------
  const openTags = (template.match(/<([a-zA-Z][a-zA-Z0-9-]*)(?=\s|>)/g) ?? []).length;
  const closeTags = (template.match(/<\/([a-zA-Z][a-zA-Z0-9-]*)/g) ?? []).length;
  if (openTags > closeTags + 5) {
    findings.push({
      kind: "missing-close-tag",
      line: 1,
      snippet: `open: ${openTags}, close: ${closeTags}`,
      description: `标签闭合疑似不平衡（开 ${openTags} / 闭 ${closeTags}）`,
      severity: "warning",
      fix: "在 IDE 里用标签配对检查（VS Code 光标停留在开标签上，查看配对闭合标签位置）",
    });
  }

  return findings;
}

// ---------- 验收 ----------

// 场景 A：经典重复 v-for（复制粘贴残留）
const dupA = `
<div class="list">
  <div class="item" v-for="item in items" :key="item.id">
    {{ item.name }}
  </div>
  <div class="item" v-for="item in items" :key="item.id">
    {{ item.name }}
  </div>
</div>
`;
const findingsA = detectDuplicateVFor(dupA);
assert.ok(findingsA.some((f) => f.kind === "duplicate-v-for" && f.severity === "error"));
console.log("[A] 同一容器缩进相同、目标相同的重复 v-for → ✗ 命中 error");

// 场景 B：同一容器拼接 3+ 不同 v-for 目标
const dupB = `
<div class="container">
  <div v-for="a in arrA" :key="a">A</div>
  <div v-for="b in arrB" :key="b">B</div>
  <div v-for="c in arrC" :key="c">C</div>
</div>
`;
const findingsB = detectDuplicateVFor(dupB);
assert.ok(findingsB.some((f) => f.kind === "duplicate-v-for" && f.severity === "warning"));
console.log("[B] 同一容器拼接 3+ 不同 v-for → ⚠ 命中 warning");

// 场景 C：正常 v-for 不应报警
const clean = `
<div class="list">
  <template v-for="group in groups" :key="group.title">
    <h3>{{ group.title }}</h3>
    <div v-for="item in group.items" :key="item.id">
      {{ item.name }}
    </div>
  </template>
</div>
`;
const findingsC = detectDuplicateVFor(clean);
assert.deepEqual(findingsC.filter((f) => f.severity === "error"), [], "嵌套层级不同的 v-for 不应报 error");
console.log("[C] 正常嵌套 v-for → ✓ 无 error");

// 场景 D：不同缩进级的相同 v-for 目标（合法！不同容器各自循环）
const legitimate = `
<div class="outer">
  <div v-for="x in data" :key="x">外层</div>
  <div class="inner">
    <div v-for="x in data" :key="x.id">内层</div>
  </div>
</div>
`;
const findingsD = detectDuplicateVFor(legitimate);
assert.deepEqual(findingsD.filter((f) => f.severity === "error"), [], "不同缩进级的相同目标不应报 error");
console.log("[D] 不同容器各自循环 → ✓ 无 error");

// 场景 E：疑似缺失闭合标签
const missing = `<div><span>text</div>`;
const findingsE = detectDuplicateVFor(missing);
assert.ok(findingsE.some((f) => f.kind === "missing-close-tag"));
console.log("[E] 疑似缺失闭合标签 → ⚠ 命中 warning");

// 完整报告输出
console.log("\n=== 示例报告（dupB 场景） ===");
for (const f of findingsB) {
  console.log(`[${f.severity.toUpperCase()}] L${f.line} ${f.kind}: ${f.description}`);
  if (f.fix) console.log(`     → 修复建议：${f.fix}`);
}

console.log("✅ 102-05 全部断言通过");
