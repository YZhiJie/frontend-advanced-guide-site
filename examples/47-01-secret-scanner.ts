// 文件: examples/47-01-secret-scanner.ts
// ============ 密钥泄漏扫描器:pre-commit / CI 的第一道防线 ============
// 设计要点:
// 1) 密钥泄漏 80% 是「误提交进 git」,扫描器要在提交前就拦住(gitleaks / git-secrets 同原理);
// 2) 模式库 = 厂商特征前缀(AKIA / sk- / ghp_)+ 高熵串 + 通用赋值(password = "...");
// 3) 白名单机制不可少:示例占位符、process.env 引用、测试夹具不该误报;
// 4) 发现即非零退出——扫描器的职责是「拦」,轮换处置见 47-04。

/** 硬断言:不满足即非零退出,让 CI 门禁能真的拦截 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 1. 模式库:每条规则带「能干什么」的影响面说明 ----------------

interface SecretRule {
  id: string;
  name: string;
  pattern: RegExp;
  impact: string; // 泄漏后攻击者能干什么——决定应急等级
}

const RULES: SecretRule[] = [
  {
    id: "aws-ak",
    name: "AWS AccessKey",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    impact: "可调用云 API,可能拖库/删资源",
  },
  {
    id: "openai-sk",
    name: "OpenAI Key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/,
    impact: "盗刷 API 额度",
  },
  {
    id: "github-pat",
    name: "GitHub Token",
    pattern: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/,
    impact: "可读私有仓库、推恶意代码",
  },
  {
    id: "jwt",
    name: "JWT",
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    impact: "有效期内可冒充用户身份",
  },
  {
    id: "private-key",
    name: "私钥块",
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
    impact: "可解密/伪造签名,等同服务器失陷",
  },
  {
    id: "generic-assign",
    name: "通用密钥赋值",
    pattern: /(?:password|secret|api[_-]?key)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
    impact: "视后端权限而定,按最高等级处理",
  },
];

// ---------------- 2. 白名单:占位符与环境变量引用不算泄漏 ----------------

const WHITELIST = [
  /process\.env\./, // ✅ 正确姿势:从环境变量读
  /import\.meta\.env\./, // ✅ Vite 注入引用
  /\$\{[A-Z_]+\}/, // ✅ shell 占位符
  /(?:x{4,}|\*{4,}|<[a-z-]+>|your[-_a-z]+)/i, // 文档占位符:xxxx / <your-key>
];

// ---------------- 3. 扫描器本体 ----------------

interface Finding {
  file: string;
  line: number;
  rule: string;
  impact: string;
  preview: string; // 只显示前 6 位——扫描报告本身也不能带完整密钥
}

function scanFile(file: string, content: string): Finding[] {
  const findings: Finding[] = [];
  content.split("\n").forEach((text, i) => {
    if (WHITELIST.some((w) => w.test(text))) return; // 白名单优先
    for (const rule of RULES) {
      const m = text.match(rule.pattern);
      if (m) {
        findings.push({
          file,
          line: i + 1,
          rule: rule.name,
          impact: rule.impact,
          preview: `${m[0].slice(0, 6)}…`,
        });
      }
    }
  });
  return findings;
}

// ---------------- 4. 演示:扫一个「问题仓库」 ----------------

const fakeRepo: Record<string, string> = {
  "src/config.ts": `
const apiKey = process.env.OPENAI_KEY        // ✅ 环境变量引用,放行
const demo = "sk-xxxxxxxxxxxxxxxxxxxxxxxx"   // ✅ 文档占位符,放行
export const bucket = "oss-prod"
`,
  "scripts/legacy.js": `
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE"       // ❌ AWS key 硬编码(AKIA+16 位)
const token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwX" // ❌ GitHub PAT 硬编码
`,
  "docs/deploy.md": `
密码是 password: "Prod@2026-leak"           // ❌ 通用赋值命中
`,
  "certs/gateway.pem": "-----BEGIN PRIVATE KEY-----\nMIIE...",
};

const all = Object.entries(fakeRepo).flatMap(([file, content]) =>
  scanFile(file, content),
);
for (const f of all) {
  console.log(
    `  ✗ ${f.file}:${f.line} 命中[${f.rule}] ${f.preview} | 影响面:${f.impact}`,
  );
}
console.log(`✓ 扫描完成:发现 ${all.length} 处泄漏,提交被拦截(exit 1)`);

assert(all.length === 4, "应恰好命中 4 处泄漏");
assert(!all.some((f) => f.file === "src/config.ts"), "白名单文件不应误报");
assert(
  all.every((f) => f.preview.endsWith("…") && f.preview.length <= 8),
  "报告预览必须截断,不能携带完整密钥",
);

console.log("\n全部断言通过:泄漏扫描器已跑通");
