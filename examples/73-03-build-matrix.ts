// 文件: examples/73-03-build-matrix.ts
// ============ 构建矩阵模拟:BUILD_TARGET 环境注入、特性开关求值、core hash 一致性校验 ============
// 设计要点:
// 1. 端差异在「构建期」决定,不在运行期判断——运行期 if (isDesktop) 会让三端产物都背上全部代码
// 2. 特性开关按目标端求值,产物里只保留命中分支,天然被 tree-shaking 掉
// 3. 三端产物里的 core 包必须逐字节一致——用 hash 校验,揪出「某端构建时被污染」的事故

import { createHash } from "node:crypto";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------- 1. BUILD_TARGET 环境注入 ----------

type BuildTarget = "web" | "desktop" | "h5";
const TARGETS: BuildTarget[] = ["web", "desktop", "h5"];

/** 模拟 Vite 的 define 注入:构建期把目标端钉死为字面量,运行期不可变 */
function injectBuildTarget(env: Record<string, string | undefined>): BuildTarget {
  const raw = env.BUILD_TARGET ?? "web"; // CI 未传时默认 web
  assert(TARGETS.includes(raw as BuildTarget), `非法 BUILD_TARGET: ${raw}(只允许 ${TARGETS.join("/")})`);
  return raw as BuildTarget;
}

// ---------- 2. 特性开关:声明式矩阵 + 按目标求值 ----------

/** 开关声明:每个特性列出「哪些端启用」,而不是在代码里写 if 端判断 */
const FEATURE_MATRIX: Record<string, BuildTarget[]> = {
  "offline-sync": ["web", "desktop", "h5"], // 离线同步:三端全量(见第 56 册)
  "system-tray": ["desktop"], // 系统托盘:仅 PC 客户端
  "rtc-call": ["desktop", "web"], // 音视频通话:H5 WebView 里体验不达标,不上
  "native-print": ["desktop"], // 原生打印(静默打印):仅 PC
  "pull-refresh": ["h5", "web"], // 下拉刷新:移动端交互范式,桌面端无
  "window-multi": ["desktop"], // 多窗口:仅 PC 客户端
};

type Flags = Record<string, boolean>;

function evaluateFlags(target: BuildTarget): Flags {
  return Object.fromEntries(Object.entries(FEATURE_MATRIX).map(([flag, targets]) => [flag, targets.includes(target)]));
}

// ---------- 3. 条件模块与 tree-shaking 隔离 ----------

interface CondModule {
  name: string;
  targets: BuildTarget[] | "all";
  /** 模拟该模块编译后的字节量(KB) */
  sizeKB: number;
}

const MODULES: CondModule[] = [
  { name: "core(领域逻辑)", targets: "all", sizeKB: 480 },
  { name: "ui(设计体系)", targets: "all", sizeKB: 320 },
  { name: "adapter-web", targets: ["web"], sizeKB: 45 },
  { name: "adapter-desktop", targets: ["desktop"], sizeKB: 60 },
  { name: "adapter-h5", targets: ["h5"], sizeKB: 38 },
  { name: "feature-system-tray", targets: ["desktop"], sizeKB: 12 },
  { name: "feature-rtc-call", targets: ["desktop", "web"], sizeKB: 210 },
  { name: "feature-pull-refresh", targets: ["h5", "web"], sizeKB: 18 },
];

/** 模拟构建:只打包目标端命中的模块——这就是「端差异代码的 tree-shaking 隔离」 */
function bundle(target: BuildTarget): { modules: string[]; sizeKB: number } {
  const picked = MODULES.filter((m) => m.targets === "all" || m.targets.includes(target));
  return { modules: picked.map((m) => m.name), sizeKB: picked.reduce((s, m) => s + m.sizeKB, 0) };
}

// ---------- 4. core 产物一致性校验:同一份 hash ----------

/** 模拟 core 包构建产物(真实环境是 packages/core 的 dist 内容) */
const CORE_DIST = `
export function createDraft(id){ /* 领域逻辑,零平台 API */ }
export function resolvePermission(user,node){ /* 权限求值,三端同一份 */ }
`.trim();

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** 三端各跑一次构建流水线,core 都取自同一 workspace 包 */
function buildPipeline(target: BuildTarget, polluted = false): { target: BuildTarget; coreHash: string; sizeKB: number } {
  // 事故模拟:有人在 desktop 构建里往 core 塞了端判断——core 被污染,hash 漂移
  const coreSrc = polluted && target === "desktop" ? `${CORE_DIST}\nif(process.platform==="win32"){/* 端代码渗入 core */}` : CORE_DIST;
  const b = bundle(target);
  return { target, coreHash: sha256(coreSrc), sizeKB: b.sizeKB };
}

/** 发布门禁:三端 core hash 必须一致,否则说明 core 被端代码污染 */
function verifyCoreConsistency(artifacts: Array<{ target: BuildTarget; coreHash: string }>): string[] {
  const hashes = new Map<string, BuildTarget[]>();
  for (const a of artifacts) {
    const list = hashes.get(a.coreHash) ?? [];
    list.push(a.target);
    hashes.set(a.coreHash, list);
  }
  if (hashes.size === 1) return [];
  // 找出「和多数派不一致」的端
  const sorted = [...hashes.entries()].sort((x, y) => y[1].length - x[1].length);
  const majority = sorted[0][0];
  return sorted.slice(1).flatMap(([, targets]) => targets.filter((t) => hashes.get(majority)!.includes(t) === false));
}

// ---------- 演示 ----------

function main() {
  // ① 环境注入:读取当前 shell 的 BUILD_TARGET(默认 web)
  const current = injectBuildTarget(process.env);
  console.log(`== ① BUILD_TARGET 注入: 当前目标 = ${current}(可用 BUILD_TARGET=desktop 重跑体验)`);

  // ② 特性开关求值:同一矩阵,三端三种配置
  console.log("\n== ② 特性开关按端求值 ==");
  for (const t of TARGETS) {
    const flags = evaluateFlags(t);
    const on = Object.keys(flags).filter((k) => flags[k]);
    console.log(`[${t}] 启用 ${on.length} 项: ${on.join(", ")}`);
  }

  // ③ 产物构成:端差异模块被隔离在各自产物里
  console.log("\n== ③ 三端产物构成(端差异模块 tree-shaking 隔离) ==");
  for (const t of TARGETS) {
    const b = bundle(t);
    console.log(`[${t}] ${b.sizeKB}KB ← ${b.modules.join(" + ")}`);
  }
  const desktopSize = bundle("desktop").sizeKB;
  const h5Size = bundle("h5").sizeKB;
  assert(desktopSize > h5Size, "desktop 带 RTC 与托盘,应显著大于 h5");

  // ④ 健康流水线:三端 core hash 一致
  console.log("\n== ④ 健康流水线:三端 core 一致性校验 ==");
  const healthy = TARGETS.map((t) => buildPipeline(t));
  for (const a of healthy) console.log(`[${a.target}] core hash = ${a.coreHash}`);
  const drift1 = verifyCoreConsistency(healthy);
  assert(drift1.length === 0, "健康流水线不应有 core 漂移");
  console.log(`三端 core hash 一致 ✅(发布门禁通过)`);

  // ⑤ 污染流水线:desktop 端 core 被渗入端代码,校验必须揪出来
  console.log("\n== ⑤ 事故模拟:desktop 构建把端代码写进了 core ==");
  const polluted = TARGETS.map((t) => buildPipeline(t, true));
  for (const a of polluted) console.log(`[${a.target}] core hash = ${a.coreHash}`);
  const drift2 = verifyCoreConsistency(polluted);
  console.log(`校验结果: 发现 ${drift2.length} 端 core 漂移 → [${drift2.join(", ")}],阻断发布 ❌`);
  assert(drift2.length === 1 && drift2[0] === "desktop", "应精确揪出 desktop 端的 core 污染");

  console.log("\n✅ 构建矩阵演示完成:开关按端求值、差异模块隔离、core hash 三端一致可校验");
}

main();
