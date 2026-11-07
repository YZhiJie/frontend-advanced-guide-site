/**
 * 第 96 部分 · Docker 与 Linux 基础（面向前端）
 * JD 需求点：通用/B 端 JD 要求"熟悉 Linux 环境、Docker 容器化部署、CI/CD"；
 *   前端需要会写 Dockerfile、理解镜像层缓存、会用 docker-compose 起本地依赖、
 *   能看懂 Linux 权限/进程/网络并在服务器上排查问题。
 * 本示例在 Node 环境模拟：
 *   1) Dockerfile 指令解析 + 层缓存命中判断（相同指令前缀复用层）
 *   2) 多阶段构建（builder → runtime 只拷贝产物，镜像瘦身）
 *   3) Linux 文件权限模型（rwx 数字/符号互转 + 用户组校验）
 *   4) 进程信号处理（SIGTERM 优雅退出 vs SIGKILL 强杀）
 *   5) docker-compose 服务依赖校验（depends_on 环检测）
 * 运行：npx tsx examples/96-01-docker-linux.ts
 */
import assert from "node:assert";

// ---------- 1. Dockerfile 解析 + 层缓存 ----------
// 每条指令生成一层；相同指令序列前缀可复用缓存层
type Instruction = { keyword: string; value: string };

function parseDockerfile(content: string): Instruction[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [kw, ...rest] = l.split(/\s+/);
      return { keyword: kw.toUpperCase(), value: rest.join(" ") };
    });
}

// 模拟层缓存：对比两个 Dockerfile 指令序列，返回可复用的层数
function cacheHitLayers(a: Instruction[], b: Instruction[]): number {
  let hit = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].keyword === b[i].keyword && a[i].value === b[i].value) hit++;
    else break; // 一旦不匹配，后续层全部失效
  }
  return hit;
}

// ---------- 2. 多阶段构建瘦身 ----------
interface ImageStage {
  name: string;
  base: string;
  sizeMB: number;
  produces: string[]; // 产物路径
}

function multiStageSize(stages: ImageStage[], runtimeCopies: string[]): number {
  // runtime 镜像大小 = 基础镜像 + 只拷贝的产物（忽略 builder 的编译中间产物）
  const runtime = stages[stages.length - 1];
  const copiedMB = runtimeCopies.reduce((sum) => sum + 5, 0); // 假设每个产物 5MB
  return runtime.sizeMB + copiedMB;
}

// ---------- 3. Linux 文件权限 ----------
// rwx → 数字：r=4 w=2 x=1，三组（owner/group/other）
function symbolicToNumeric(sym: string): number {
  // 如 "rwxr-xr--"
  assert(sym.length === 9, "符号权限应为 9 字符");
  const map: Record<string, number> = { r: 4, w: 2, x: 1, "-": 0 };
  let n = 0;
  for (let i = 0; i < 9; i += 3) {
    const group = sym.slice(i, i + 3);
    let g = 0;
    for (const c of group) g += map[c] ?? 0;
    n = n * 10 + g;
  }
  return n;
}

function numericToSymbolic(n: number): string {
  const digits = n.toString().padStart(3, "0");
  const chars = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
  return digits.split("").map((d) => chars[+d]).join("");
}

// 判断某用户对文件的权限
function canAccess(
  fileMode: number,
  fileOwner: string,
  fileGroup: string,
  user: string,
  userGroups: string[],
  action: "read" | "write" | "execute"
): boolean {
  const sym = numericToSymbolic(fileMode);
  let idx = 6; // other 默认
  if (user === fileOwner) idx = 0;
  else if (userGroups.includes(fileGroup)) idx = 3;
  const group = sym.slice(idx, idx + 3);
  const bit = action === "read" ? 0 : action === "write" ? 1 : 2;
  return group[bit] !== "-";
}

// ---------- 4. 进程信号 ----------
type Signal = "SIGTERM" | "SIGKILL" | "SIGINT";
interface Process {
  pid: number;
  name: string;
  graceful: boolean; // 是否注册了 SIGTERM handler
}

function sendSignal(proc: Process, sig: Signal): { killed: boolean; graceful: boolean } {
  if (sig === "SIGKILL") return { killed: true, graceful: false }; // 不可捕获
  if (proc.graceful) return { killed: true, graceful: true }; // 优雅退出
  // 没注册 handler 的 SIGTERM 默认也会终止，但不算优雅（可能丢数据）
  return { killed: true, graceful: false };
}

// ---------- 5. docker-compose 依赖环检测 ----------
interface ComposeService {
  name: string;
  dependsOn: string[];
}

function hasCycle(services: ComposeService[]): boolean {
  const graph = new Map(services.map((s) => [s.name, s.dependsOn]));
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const dep of graph.get(node) ?? []) {
      if (dfs(dep)) return true;
    }
    stack.delete(node);
    return false;
  }
  for (const s of services) if (dfs(s.name)) return true;
  return false;
}

// ===================== 运行断言 =====================
console.log("===== 1. Dockerfile 层缓存 =====");
const oldDf = parseDockerfile(`
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
`);
const newDf = parseDockerfile(`
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --mode=production
`);
const hits = cacheHitLayers(oldDf, newDf);
assert(hits === 5, `前 5 条指令相同应命中 5 层缓存，实际 ${hits}`);
console.log(`✓ 层缓存：修改最后一条指令，前 ${hits} 层复用`);

console.log("\n===== 2. 多阶段构建瘦身 =====");
const singleStage = multiStageSize(
  [{ name: "app", base: "node:20", sizeMB: 350, produces: ["/app/dist"] }],
  ["/app/dist", "/app/node_modules"]
);
const multiStage = multiStageSize(
  [
    { name: "builder", base: "node:20", sizeMB: 350, produces: ["/app/dist"] },
    { name: "runtime", base: "nginx:alpine", sizeMB: 40, produces: [] },
  ],
  ["/app/dist"]
);
assert(multiStage < singleStage, `多阶段应更轻量：多阶段 ${multiStage}MB < 单阶段 ${singleStage}MB`);
console.log(`✓ 瘦身：单阶段 ${singleStage}MB → 多阶段 ${multiStage}MB`);

console.log("\n===== 3. Linux 文件权限 =====");
assert(symbolicToNumeric("rwxr-xr--") === 754, "rwxr-xr-- 应为 754");
assert(numericToSymbolic(644) === "rw-r--r--", "644 应为 rw-r--r--");
// owner 是 alice，文件 644 (rw-r--r--)，bob 不在组里只能读
assert(canAccess(644, "alice", "dev", "bob", ["ops"], "read") === true, "bob 可读");
assert(canAccess(644, "alice", "dev", "bob", ["ops"], "write") === false, "bob 不可写");
// alice 是 owner，可读写
assert(canAccess(644, "alice", "dev", "alice", ["dev"], "write") === true, "alice 可写");
console.log("✓ 权限：符号/数字互转 + 用户组校验正确");

console.log("\n===== 4. 进程信号 =====");
const app: Process = { pid: 100, name: "node", graceful: true };
const term = sendSignal(app, "SIGTERM");
assert(term.graceful === true, "注册 handler 的进程收到 SIGTERM 应优雅退出");
const kill = sendSignal(app, "SIGKILL");
assert(kill.graceful === false, "SIGKILL 不可捕获，非优雅");
console.log("✓ 信号：SIGTERM 优雅 / SIGKILL 强杀");

console.log("\n===== 5. docker-compose 依赖环检测 =====");
const noCycle = hasCycle([
  { name: "web", dependsOn: ["api"] },
  { name: "api", dependsOn: ["db"] },
  { name: "db", dependsOn: [] },
]);
assert(noCycle === false, "正常依赖链不应有环");

const withCycle = hasCycle([
  { name: "web", dependsOn: ["api"] },
  { name: "api", dependsOn: ["web"] }, // 环
]);
assert(withCycle === true, "web↔api 应检测到环");
console.log("✓ compose：环检测正确（正常链无环，互依赖有环）");

console.log("\n✅ Docker 层缓存 + 多阶段瘦身 + Linux 权限 + 进程信号 + compose 环检测全部通过");
