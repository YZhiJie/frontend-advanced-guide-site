// 文件: examples/53-01-nginx-config-linter.ts
// ============ Nginx 配置静态检查:把上线前踩过的坑变成规则 ============
// 设计要点:
// 1) 大多数 Nginx 事故不是「不会写」,而是「少了一行」——用规则把隐性要求显性化;
// 2) 检查器不需要完整解析 Nginx 语法,按块 + 指令做轻量扫描就能覆盖高频问题;
// 3) 每条规则都要给出「为什么」和「怎么改」,否则告警会被忽略。

type Severity = "error" | "warn" | "info";

interface Issue {
  rule: string;
  severity: Severity;
  line: number;
  message: string;
  fix: string;
}

interface Block {
  header: string;
  startLine: number;
  lines: Array<{ text: string; line: number }>;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

function stripComment(line: string): string {
  const i = line.indexOf("#");
  return (i >= 0 ? line.slice(0, i) : line).trim();
}

/** 只识别单层 location/server 块,足够覆盖本示例的规则 */
function parseBlocks(config: string): Block[] {
  const blocks: Block[] = [];
  const stack: Block[] = [];
  config.split("\n").forEach((raw, idx) => {
    const lineNo = idx + 1;
    const text = stripComment(raw);
    if (!text) return;
    const open = text.match(/^(server|location\s+[^\s{]+)\s*\{/);
    if (open) {
      const block: Block = { header: open[1], startLine: lineNo, lines: [] };
      blocks.push(block);
      stack.push(block);
      return;
    }
    if (text.startsWith("}")) {
      stack.pop();
      return;
    }
    if (stack.length)
      stack[stack.length - 1].lines.push({ text, line: lineNo });
  });
  return blocks;
}

function lint(config: string): Issue[] {
  const issues: Issue[] = [];
  const blocks = parseBlocks(config);
  const servers = blocks.filter((b) => b.header === "server");

  for (const block of blocks) {
    const text = block.lines.map((l) => l.text).join("\n");
    const location = block.header.startsWith("location") ? block.header : null;

    // R1:location 以 / 结尾 + proxy_pass 不带 URI → 路径不会被截断
    if (location?.endsWith("/")) {
      const pass = block.lines.find((l) => l.text.startsWith("proxy_pass"));
      if (pass && !/proxy_pass\s+https?:\/\/[^;]+\/[^;]*;/.test(pass.text)) {
        issues.push({
          rule: "proxy-pass-trailing-slash",
          severity: "warn",
          line: pass.line,
          message: `${location} 以 / 结尾,但 proxy_pass 未带 URI,原始路径会整体透传`,
          fix: "确认后端是否需要 /api 前缀:需要则 proxy_pass http://upstream;不需要则写 http://upstream/",
        });
      }
    }

    // R2:WebSocket location 缺 Upgrade/Connection 头
    if (
      (/\/ws(?:\/|\s|$)/.test(block.header) ||
        /upgrade|websocket|socket/i.test(block.header + text)) &&
      !/Upgrade\s+\$http_upgrade/.test(text)
    ) {
      issues.push({
        rule: "websocket-headers",
        severity: "error",
        line: block.startLine,
        message: "疑似 WebSocket 代理,但缺少 Upgrade/Connection 头,握手会失败",
        fix: 'proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";',
      });
    }

    // R3:SSE 未关闭缓冲
    if (
      /text\/event-stream|sse/i.test(text) &&
      !/proxy_buffering\s+off/.test(text)
    ) {
      issues.push({
        rule: "sse-buffering",
        severity: "warn",
        line: block.startLine,
        message: "SSE 未关闭 proxy_buffering,消息会被攒批延迟",
        fix: "proxy_buffering off; proxy_cache off; proxy_read_timeout 3600s;",
      });
    }

    // R4:if 块里写 proxy_pass(部分版本直接报错)
    if (/^\s*if\s*\(/m.test(text) && /proxy_pass/.test(text)) {
      issues.push({
        rule: "proxy-pass-in-if",
        severity: "error",
        line: block.startLine,
        message: "proxy_pass 出现在 if 块中,部分版本不允许,行为不可预期",
        fix: "用 map / 独立 location / upstream 分流,不要在 if 里做代理",
      });
    }
  }

  // R5:SPA 缺少 try_files 回退
  for (const block of blocks) {
    if (!block.header.startsWith("location")) continue;
    const text = block.lines.map((l) => l.text).join("\n");
    if (
      block.header.includes("/") &&
      /root|alias/.test(text) &&
      !/try_files/.test(text)
    ) {
      issues.push({
        rule: "spa-fallback",
        severity: "warn",
        line: block.startLine,
        message: "静态站点 location 未配置 try_files,刷新子路由会 404",
        fix: "try_files $uri $uri/ /index.html;",
      });
    }
  }

  // R6:gzip 开了但没声明类型
  const gzipOn = /gzip\s+on;/.test(config);
  if (gzipOn && !/gzip_types/.test(config)) {
    issues.push({
      rule: "gzip-types",
      severity: "info",
      line: 1,
      message: "gzip on 但未配置 gzip_types,默认只压缩 text/html",
      fix: "gzip_types text/css application/javascript application/json image/svg+xml;",
    });
  }

  // R7:重复 server_name
  const names = servers
    .flatMap((s) => s.lines.filter((l) => l.text.startsWith("server_name")))
    .map((l) => ({
      name: l.text.replace(/^server_name\s+|;$/g, ""),
      line: l.line,
    }));
  const seen = new Map<string, number>();
  for (const { name, line } of names) {
    if (seen.has(name)) {
      issues.push({
        rule: "duplicate-server-name",
        severity: "warn",
        line,
        message: `server_name ${name} 与其第 ${seen.get(name)} 行重复`,
        fix: "合并 server 块,或确认是否应为不同端口/不同域名",
      });
    } else {
      seen.set(name, line);
    }
  }

  return issues;
}

// ---------------- 场景 1:问题配置 ----------------
const bad = `
server {
  server_name example.com;
  gzip on;
  location /api/ {
    proxy_pass http://backend;
    try_files $uri $uri/ /index.html;
  }
  location /ws {
    proxy_pass http://backend;
  }
  location /events {
    proxy_pass http://backend;
    add_header Content-Type text/event-stream;
  }
}
server {
  server_name example.com;
}
`;

const badIssues = lint(bad);
console.log("=== 问题配置 ===");
for (const i of badIssues)
  console.log(`[${i.severity}] L${i.line} ${i.rule}: ${i.message}`);
assert(
  badIssues.some((i) => i.rule === "proxy-pass-trailing-slash"),
  "应发现 proxy_pass 尾斜杠问题",
);
assert(
  badIssues.some((i) => i.rule === "websocket-headers"),
  "应发现 WebSocket 头缺失",
);
assert(
  badIssues.some((i) => i.rule === "sse-buffering"),
  "应发现 SSE 缓冲未关闭",
);
assert(
  badIssues.some((i) => i.rule === "gzip-types"),
  "应发现 gzip_types 缺失",
);
assert(
  badIssues.some((i) => i.rule === "duplicate-server-name"),
  "应发现重复 server_name",
);

// ---------------- 场景 2:正确配置 ----------------
const good = `
server {
  server_name example.com;
  gzip on;
  gzip_types text/css application/javascript application/json;
  location /api/ {
    proxy_pass http://backend/;
  }
  location /ws {
    proxy_pass http://backend;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
  location /events {
    proxy_pass http://backend;
    proxy_buffering off;
  }
  location / {
    root /var/www/site;
    try_files $uri $uri/ /index.html;
  }
}
`;
const goodIssues = lint(good);
console.log("\n=== 正确配置 ===");
console.log(goodIssues.length === 0 ? "无告警" : goodIssues);
assert(goodIssues.length === 0, "正确配置不应产生告警");

console.log(
  "\n检查器通过:尾斜杠、WebSocket、SSE、gzip、SPA 回退、重复域名六类规则生效。",
);

// 标记为模块,避免与其它示例的顶层变量重名
export {};
