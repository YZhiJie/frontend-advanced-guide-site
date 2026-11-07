/**
 * 第 127 部分配套：Docker 镜像交付审计器
 * JD 需求点：镜像要可重复构建、可缓存、体积可控、非 root、能健康检查、
 *   不把密钥和构建垃圾带进产物。
 * 本示例读取 examples/deploy/docker 下的真实 Dockerfile 与 .dockerignore：
 *   1) 多阶段与基础镜像标签
 *   2) 层缓存顺序（依赖清单先于源码）
 *   3) 运行阶段只装生产依赖
 *   4) 非 root / HEALTHCHECK / exec-form CMD
 *   5) 密钥泄漏与 .dockerignore 白名单
 * 运行：npx tsx examples/127-05-docker-image-audit.ts
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

interface Stage {
  name: string;
  base: string;
  body: string;
}

interface Issue {
  level: "error" | "warn";
  rule: string;
  message: string;
}

function parseStages(src: string): Stage[] {
  const lines = src.split("\n");
  const stages: Stage[] = [];
  let current: Stage | null = null;
  for (const line of lines) {
    const from = line.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i);
    if (from) {
      current = { base: from[1], name: from[2] ?? String(stages.length), body: "" };
      stages.push(current);
      continue;
    }
    if (current) current.body += line + "\n";
  }
  return stages;
}

function auditDockerfile(src: string, opts: { name: string; runtimeUser: string }): Issue[] {
  const issues: Issue[] = [];
  const err = (rule: string, message: string) =>
    issues.push({ level: "error", rule, message });
  const warn = (rule: string, message: string) =>
    issues.push({ level: "warn", rule, message });

  const stages = parseStages(src);
  if (stages.length < 2) err("stage.multi", "必须是多阶段构建，避免把构建工具带进运行镜像");

  for (const s of stages) {
    if (s.base.endsWith(":latest") || !s.base.includes(":")) {
      err("base.tag", `基础镜像未固定版本：${s.base}（latest 会让构建不可重复）`);
    }
  }

  const runtime = stages[stages.length - 1];
  const runtimeIsNode = /node/i.test(runtime.base);
  const beforeCopyAll = runtime.body.split(/^COPY\s+\.\s+\./m)[0];
  if (runtimeIsNode) {
    if (!/^(COPY|ADD)\s+package\.json/m.test(runtime.body)) {
      err("cache.deps", "Node 运行阶段未单独拷贝依赖清单，无法复用依赖层缓存");
    } else if (/COPY\s+\.\s+\./.test(runtime.body) && !/install/.test(beforeCopyAll)) {
      err("cache.deps", "运行阶段未先安装依赖再拷贝源码，源码一改就击穿依赖层缓存");
    }
  }

  // 只允许「在源码之前安装依赖」：builder 阶段同样适用
  for (const s of stages) {
    if (!/COPY\s+\.\s+\./.test(s.body)) continue;
    const before = s.body.slice(0, s.body.search(/COPY\s+\.\s+\./));
    if (!/install/.test(before)) {
      err("cache.order", `阶段 ${s.name} 在 COPY . . 之前没有安装依赖`);
    }
  }

  const prodInstall = /install[^\n]*--(prod|omit=dev|production)/.test(runtime.body);
  if (runtimeIsNode && !prodInstall) {
    err("runtime.prod", "运行阶段没有只装生产依赖（--prod / --omit=dev）");
  }

  const userMatch = runtime.body.match(/^USER\s+(\S+)/m);
  if (!userMatch) {
    err("security.user", "运行阶段缺少 USER，容器默认以 root 运行");
  } else {
    const user = userMatch[1];
    if (user === "root" || user === "0") err("security.user", "运行阶段显式使用了 root");
    else if (![opts.runtimeUser, "node", "1000", "101", "nginx"].includes(user)) {
      warn("security.user", `请确认 USER ${user} 在镜像内真实存在且无写权限`);
    }
  }

  if (!/^HEALTHCHECK\s/m.test(src)) err("ops.healthcheck", "缺少 HEALTHCHECK");
  if (!/^EXPOSE\s+\d+/m.test(src)) warn("ops.expose", "缺少 EXPOSE（仅为文档性，但便于排障）");

  const cmd = runtime.body.match(/^CMD\s+(.+)$/m);
  if (!cmd) err("runtime.cmd", "缺少 CMD");
  else if (!cmd[1].trim().startsWith("[")) {
    err("runtime.cmd", "CMD 不是 exec form（shell form 会让 node 收不到 SIGTERM）");
  }

  // 密钥扫描：只允许明显的占位值
  for (const line of src.split("\n")) {
    if (!/^\s*(ENV|ARG)\s+/i.test(line)) continue;
    if (!/(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY)/i.test(line)) continue;
    if (/(replace-me|changeme|example|dummy|\$\{)/i.test(line)) continue;
    err("security.secret", `构建参数疑似包含真实密钥：${line.trim()}`);
  }

  // 运行阶段不应再拷贝源码整目录
  if (/COPY\s+\.\s+\./.test(runtime.body) && !/--from=build/.test(runtime.body)) {
    warn("runtime.copy", "运行阶段拷贝了整个上下文，确认其中没有源码/测试/本地配置");
  }

  return issues;
}

function auditDockerignore(src: string): Issue[] {
  const issues: Issue[] = [];
  const lines = src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  for (const must of ["node_modules", ".git", ".env", "dist"]) {
    if (!lines.some((l) => l === must || l === `**/${must}`)) {
      issues.push({
        level: "error",
        rule: "context.ignore",
        message: `.dockerignore 未排除 ${must}`,
      });
    }
  }
  // .env.* 与 !.env.example 的组合：允许示例，拒绝真实值
  if (!lines.includes(".env.*")) {
    issues.push({ level: "warn", rule: "context.env", message: ".dockerignore 建议排除 .env.*" });
  }
  return issues;
}

const FRONTEND = readFileSync("examples/deploy/docker/Dockerfile.frontend", "utf8");
const BFF = readFileSync("examples/deploy/docker/Dockerfile.bff", "utf8");
const IGNORE = readFileSync("examples/deploy/docker/.dockerignore", "utf8");

// ===================== 运行断言 =====================
console.log("===== 1. 前端镜像 =====");
const frontendIssues = auditDockerfile(FRONTEND, { name: "frontend", runtimeUser: "101" });
const frontendErrors = frontendIssues.filter((i) => i.level === "error");
assert.deepStrictEqual(
  frontendErrors,
  [],
  `前端镜像存在 error：\n${frontendErrors.map((i) => `[${i.rule}] ${i.message}`).join("\n")}`,
);
const frontendStages = parseStages(FRONTEND);
assert(frontendStages.length === 2, `前端镜像应为 2 阶段，实际 ${frontendStages.length}`);
assert(frontendStages[1].base.includes("nginx-unprivileged"), "运行镜像应使用 nginx-unprivileged");
assert(/COPY\s+--from=build\s+\/app\/dist/.test(FRONTEND), "运行阶段只应拷贝 dist");
assert(!/COPY\s+--from=build\s+\/app\/node_modules/.test(FRONTEND), "不应拷贝 node_modules");
console.log(`✓ 2 阶段 / 非 root(101) / HEALTHCHECK / 只拷 dist；warn=${frontendIssues.length}`);

console.log("\n===== 2. BFF 镜像 =====");
const bffIssues = auditDockerfile(BFF, { name: "bff", runtimeUser: "node" });
const bffErrors = bffIssues.filter((i) => i.level === "error");
assert.deepStrictEqual(
  bffErrors,
  [],
  `BFF 镜像存在 error：\n${bffErrors.map((i) => `[${i.rule}] ${i.message}`).join("\n")}`,
);
assert(/cmd\s*\[\s*"node"/i.test(BFF), "BFF CMD 必须是 exec form");
assert(/USER\s+node/m.test(BFF), "BFF 必须以 node 用户运行");
console.log(`✓ 多阶段 / 生产依赖 / USER node / exec CMD；warn=${bffIssues.length}`);

console.log("\n===== 3. .dockerignore =====");
const ignoreIssues = auditDockerignore(IGNORE);
assert.deepStrictEqual(
  ignoreIssues.filter((i) => i.level === "error"),
  [],
  "构建上下文排除项不完整",
);
assert(/^node_modules$/m.test(IGNORE), "必须排除 node_modules");
assert(/^\.env\.\*$/m.test(IGNORE), "必须排除 .env.*");
console.log("✓ node_modules / .git / dist / .env.* 均已排除");

console.log("\n===== 4. 反例：单阶段 + root + 无健康检查 =====");
const BAD = `FROM node:latest
WORKDIR /app
COPY . .
RUN npm install
ENV API_TOKEN=sk-real-secret-value
CMD node server.js
`;
const badIssues = auditDockerfile(BAD, { name: "bad", runtimeUser: "node" });
const badRules = new Set(badIssues.map((i) => i.rule));
for (const rule of ["stage.multi", "base.tag", "cache.order", "runtime.prod", "security.user", "ops.healthcheck", "runtime.cmd", "security.secret"]) {
  assert(badRules.has(rule), `反例应命中 ${rule}，实际：${[...badRules].join(", ")}`);
}
console.log(`✓ 反例命中 ${badRules.size} 类问题：${[...badRules].join(", ")}`);

console.log("\n===== 5. 镜像标签策略 =====");
interface ImageTag {
  env: string;
  tag: string;
  mutable: boolean;
}
const tags: ImageTag[] = [
  { env: "dev", tag: "sha-7f3a2b", mutable: false },
  { env: "staging", tag: "sha-7f3a2b", mutable: false },
  { env: "prod", tag: "1.88.0", mutable: false },
];
assert(tags.every((t) => !t.mutable), "所有环境都必须使用不可变 tag，禁止 latest / 浮动 tag");
assert(new Set(tags.map((t) => t.tag)).size >= 2, "生产 tag 应与开发 tag 可区分");
const prodTag = tags.find((t) => t.env === "prod")!;
assert(/^\d+\.\d+\.\d+$/.test(prodTag.tag), "生产 tag 应为语义化版本");
console.log(`✓ 开发用 sha、生产用语义化版本：${tags.map((t) => `${t.env}=${t.tag}`).join(" / ")}`);

console.log("\n✅ Docker 交付：多阶段 + 缓存顺序 + 生产依赖 + 非 root + 健康检查 + 密钥扫描全部通过");
