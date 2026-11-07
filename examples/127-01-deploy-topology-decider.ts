/**
 * 第 127 部分配套：部署拓扑选型决策器
 * JD 需求点：能根据 SSR/长连接/合规/团队运维成熟度，在静态托管、边缘函数、
 *   Node BFF、Kubernetes、混合架构之间做出可解释的选型，并给出敏感性结论。
 * 本示例：
 *   1) 硬约束过滤（不满足直接淘汰，不参与打分）
 *   2) 加权能力矩阵打分 + 运维成本惩罚
 *   3) 输出「为什么选它 / 为什么不选其他」
 *   4) 敏感性检查：调整权重后冠军是否变化
 * 运行：npx tsx examples/127-01-deploy-topology-decider.ts
 */
import assert from "node:assert";

type TopologyId = "static-cdn" | "static-edge" | "node-bff" | "k8s" | "hybrid";

interface Requirement {
  /** 是否需要服务端渲染（SEO 首屏） */
  ssr: boolean;
  /** 是否需要长连接（WebSocket / SSE 服务端主动推送） */
  longConnection: boolean;
  /** 是否需要私有网络内访问后端（金融/政企常见） */
  privateNetwork: boolean;
  /** 团队运维成熟度 0~5：有没有人值班、会不会看 K8s 事件与 Nginx 日志 */
  opsMaturity: number;
  /** 发布频率（次/周） */
  releasesPerWeek: number;
  /** 是否需要按请求做 A/B 或灰度分流 */
  trafficSplitting: boolean;
}

interface Topology {
  id: TopologyId;
  name: string;
  /** 0~1 的能力匹配度 */
  fit: {
    ssr: number;
    longConnection: number;
    privateNetwork: number;
    trafficSplitting: number;
    releaseVelocity: number;
  };
  /** 运维成本 0~1（越高越重） */
  opsCost: number;
  note: string;
}

const TOPOLOGIES: Topology[] = [
  {
    id: "static-cdn",
    name: "对象存储 + CDN",
    fit: { ssr: 0, longConnection: 0, privateNetwork: 0.2, trafficSplitting: 0.3, releaseVelocity: 1 },
    opsCost: 0.1,
    note: "纯静态 SPA，成本最低；SSR 与长连接必须另找后端",
  },
  {
    id: "static-edge",
    name: "静态托管 + 边缘函数",
    fit: { ssr: 0.6, longConnection: 0.4, privateNetwork: 0.3, trafficSplitting: 0.8, releaseVelocity: 0.9 },
    opsCost: 0.25,
    note: "边缘做 SSR/AB/鉴权重写；受运行时限制，重计算不适合",
  },
  {
    id: "node-bff",
    name: "单机/多机 Node BFF + Nginx",
    fit: { ssr: 0.8, longConnection: 0.9, privateNetwork: 0.9, trafficSplitting: 0.7, releaseVelocity: 0.7 },
    opsCost: 0.45,
    note: "前端团队能独立维护；扩容靠加机器，发布要自己做蓝绿",
  },
  {
    id: "k8s",
    name: "Kubernetes（Deployment + Ingress + HPA）",
    fit: { ssr: 1, longConnection: 1, privateNetwork: 1, trafficSplitting: 0.9, releaseVelocity: 0.85 },
    opsCost: 0.85,
    note: "能力最全；没有平台团队时，K8s 本身就是最大的故障源",
  },
  {
    id: "hybrid",
    name: "静态 CDN + 容器化 BFF",
    fit: { ssr: 0.9, longConnection: 1, privateNetwork: 0.95, trafficSplitting: 0.9, releaseVelocity: 0.9 },
    opsCost: 0.6,
    note: "静态走 CDN、动态走 BFF，职责清晰；两套发布链路要统一版本号",
  },
];

interface Weights {
  ssr: number;
  longConnection: number;
  privateNetwork: number;
  trafficSplitting: number;
  releaseVelocity: number;
  opsCost: number;
}

const DEFAULT_WEIGHTS: Weights = {
  ssr: 25,
  longConnection: 20,
  privateNetwork: 15,
  trafficSplitting: 15,
  releaseVelocity: 10,
  opsCost: 15,
};

interface Scored {
  topology: Topology;
  score: number;
  reasons: string[];
}

/** 硬约束：返回空数组表示可进入打分 */
function hardFailures(t: Topology, r: Requirement): string[] {
  const out: string[] = [];
  if (r.ssr && t.fit.ssr < 0.5) out.push("需要 SSR，但该拓扑没有服务端渲染能力");
  if (r.longConnection && t.fit.longConnection < 0.5)
    out.push("需要长连接，但该拓扑只适合请求-响应");
  if (r.privateNetwork && t.fit.privateNetwork < 0.5)
    out.push("必须访问私有网络后端，该拓扑无法直连");
  if (r.opsMaturity < 3 && t.id === "k8s")
    out.push("运维成熟度不足 3 分，K8s 的故障半径超出团队承受能力");
  if (r.releasesPerWeek >= 10 && t.fit.releaseVelocity < 0.6)
    out.push("每周发布 ≥ 10 次，该拓扑的发布效率不达标");
  return out;
}

function scoreTopology(t: Topology, r: Requirement, w: Weights): number {
  const raw =
    (r.ssr ? t.fit.ssr * w.ssr : 0) +
    (r.longConnection ? t.fit.longConnection * w.longConnection : 0) +
    (r.privateNetwork ? t.fit.privateNetwork * w.privateNetwork : 0) +
    (r.trafficSplitting ? t.fit.trafficSplitting * w.trafficSplitting : 0) +
    t.fit.releaseVelocity * w.releaseVelocity +
    (1 - t.opsCost) * w.opsCost;
  return Math.round(raw * 10) / 10;
}

function decide(r: Requirement, w: Weights = DEFAULT_WEIGHTS): {
  winner: Topology;
  scored: Scored[];
  eliminated: { id: TopologyId; reasons: string[] }[];
} {
  const scored: Scored[] = [];
  const eliminated: { id: TopologyId; reasons: string[] }[] = [];
  for (const t of TOPOLOGIES) {
    const fails = hardFailures(t, r);
    if (fails.length) {
      eliminated.push({ id: t.id, reasons: fails });
      continue;
    }
    const reasons = [
      r.ssr ? `SSR 匹配 ${(t.fit.ssr * 100).toFixed(0)}%` : "",
      r.longConnection ? `长连接匹配 ${(t.fit.longConnection * 100).toFixed(0)}%` : "",
      `发布效率 ${(t.fit.releaseVelocity * 100).toFixed(0)}%`,
      `运维成本 ${(t.opsCost * 100).toFixed(0)}%`,
    ].filter(Boolean);
    scored.push({ topology: t, score: scoreTopology(t, r, w), reasons });
  }
  assert(scored.length > 0, "所有拓扑都被硬约束淘汰：需要重新评估需求或补充平台能力");
  scored.sort((a, b) => b.score - a.score || a.topology.id.localeCompare(b.topology.id));
  return { winner: scored[0].topology, scored, eliminated };
}

/** 敏感性：把运维权重翻倍，冠军是否变化 */
function sensitivity(r: Requirement, w: Weights): { stable: boolean; next: TopologyId } {
  const before = decide(r, w);
  const stressed = decide(r, { ...w, opsCost: w.opsCost * 2 });
  return { stable: before.winner.id === stressed.winner.id, next: stressed.winner.id };
}

// ===================== 运行断言 =====================
console.log("===== 1. 纯内容站：静态托管胜出 =====");
const contentSite: Requirement = {
  ssr: false,
  longConnection: false,
  privateNetwork: false,
  opsMaturity: 2,
  releasesPerWeek: 3,
  trafficSplitting: false,
};
const r1 = decide(contentSite);
assert.strictEqual(r1.winner.id, "static-cdn", `内容站应选静态 CDN，实际 ${r1.winner.id}`);
assert(r1.eliminated.some((e) => e.id === "k8s"), "运维成熟度不足时 K8s 必须被硬约束淘汰");
console.log(`✓ 选中 ${r1.winner.name}（${r1.scored[0].score} 分）`);
console.log(`  理由：${r1.scored[0].reasons.join(" / ")}`);

console.log("\n===== 2. 带登录与实时通知的 B 端：静态+BFF 胜出 =====");
const b2b: Requirement = {
  ssr: false,
  longConnection: true,
  privateNetwork: true,
  opsMaturity: 4,
  releasesPerWeek: 5,
  trafficSplitting: true,
};
const r2 = decide(b2b);
assert(
  ["node-bff", "hybrid", "k8s"].includes(r2.winner.id),
  `B 端应选可承载长连接的方案，实际 ${r2.winner.id}`,
);
assert(!r2.scored.some((s) => s.topology.id === "static-cdn"), "静态 CDN 不应进入长连接场景的打分");
console.log(`✓ 选中 ${r2.winner.name}（${r2.scored[0].score} 分）`);
assert(
  r2.eliminated.find((e) => e.id === "static-cdn")!.reasons.some((x) => x.includes("长连接")),
  "淘汰理由必须可解释",
);

console.log("\n===== 3. 高频发布的 SSR 站：K8s 或混合架构 =====");
const ssrSite: Requirement = {
  ssr: true,
  longConnection: false,
  privateNetwork: true,
  opsMaturity: 5,
  releasesPerWeek: 20,
  trafficSplitting: true,
};
const r3 = decide(ssrSite);
assert(["k8s", "hybrid"].includes(r3.winner.id), `高频 SSR 应选容器化方案，实际 ${r3.winner.id}`);
assert(r3.scored.every((s) => s.topology.fit.ssr >= 0.5), "进入打分的方案都必须满足 SSR 下限");
console.log(`✓ 选中 ${r3.winner.name}（${r3.scored[0].score} 分）`);

console.log("\n===== 4. 敏感性：运维权重翻倍后是否翻盘 =====");
const s1 = sensitivity(b2b, DEFAULT_WEIGHTS);
const s2 = sensitivity(ssrSite, DEFAULT_WEIGHTS);
assert.strictEqual(s1.stable, true, `B 端选型应对运维成本不敏感，实际翻成 ${s1.next}`);
assert.strictEqual(s2.stable, true, `SSR 站选型应对运维成本不敏感，实际翻成 ${s2.next}`);
console.log(`✓ 两组需求在运维权重翻倍后冠军不变（${s1.next} / ${s2.next}）`);

console.log("\n===== 5. 决策必须可解释 =====");
for (const item of r3.scored) {
  assert(item.reasons.length >= 2, `${item.topology.id} 的理由过少，无法向团队解释`);
  assert(item.score > 0 && item.score <= 100, `${item.topology.id} 分数越界：${item.score}`);
}
const totalWeight = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
assert.strictEqual(totalWeight, 100, "默认权重之和必须为 100，便于横向比较");
console.log(`✓ ${r3.scored.length} 个候选方案均有 ≥2 条理由，权重和 = ${totalWeight}`);

console.log("\n✅ 拓扑选型：硬约束过滤 + 加权打分 + 可解释性 + 敏感性检查全部通过");
