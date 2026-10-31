/** 68-01-channel-selector.ts —— 音视频形态选型：延迟预算、互动强度与传输通道决策 */

type Shape = "playback" | "broadcast" | "interactive-class" | "one-to-one" | "many-to-many";
type Transport = "cdn" | "rtc" | "hybrid";

interface Demand {
  shape: Shape;
  viewers: number;
  /** 可接受的最大端到端延迟(毫秒),由业务话术倒推而来 */
  maxLatencyMs: number;
  /** 海外分发区域数 */
  regions: number;
  budgetYuanPerHour: number;
}

interface Decision {
  transport: Transport;
  expectedLatencyMs: number;
  reasons: string[];
  risks: string[];
}

/** 示意量级,不是厂商实测值:CDN 3-30s,RTC 100-400ms,混合取两者优点 */
const LATENCY: Record<Transport, number> = { cdn: 8000, rtc: 260, hybrid: 320 };

/**
 * 选型只回答三个问题:
 *   1) 观众要不要「立刻回应」主播?(延迟预算)
 *   2) 有几个人需要「互相看见」?(RTC 通道人数)
 *   3) 规模有多大、能花多少钱?(CDN 与转码成本)
 * 先定延迟预算,再看预算够不够;反过来(先看价格)一定会做出「便宜但没人用」的产品。
 */
function select(d: Demand): Decision {
  const reasons: string[] = [];
  const risks: string[] = [];

  if (d.shape === "one-to-one" || d.shape === "many-to-many") {
    reasons.push("双方需要实时互见,RTC 是唯一满足 < 500ms 的通道");
    if (d.viewers > 12) risks.push("单房间 RTC 并发过大,需分房间/分层转发");
    return { transport: "rtc", expectedLatencyMs: LATENCY.rtc, reasons, risks };
  }

  if (d.shape === "playback") {
    reasons.push("点播允许秒级延迟,CDN 成本最低");
    if (d.maxLatencyMs < 3000) risks.push("业务要求秒开秒播,纯 CDN 需靠预加载与首帧优化兜底");
    return { transport: "cdn", expectedLatencyMs: LATENCY.cdn, reasons, risks };
  }

  if (d.shape === "interactive-class") {
    reasons.push("师生需连麦,但大多数学生只看:主播走 RTC、观众走 CDN");
    if (d.viewers > 1000) risks.push("千人大班连麦需限制上台人数,否则 RTC 成本失控");
    if (d.maxLatencyMs < 1000) risks.push("观众端延迟 300-500ms 已接近极限,别承诺「零延迟」");
    return { transport: "hybrid", expectedLatencyMs: LATENCY.hybrid, reasons, risks };
  }

  // 直播带货/秀场:主播互动 + 海量围观
  reasons.push("主播侧要实时看评论与连麦,观众侧要扛住峰值并发");
  const hybridCost = estimateHourlyCost(d, "hybrid");
  if (hybridCost > d.budgetYuanPerHour) {
    reasons.push(`混合方案估算 ${hybridCost} 元/小时,超出预算,退化为纯 CDN 直播`);
    risks.push("退化为纯 CDN 后延迟升至秒级,秒杀/抢购类话术会失效");
    return { transport: "cdn", expectedLatencyMs: LATENCY.cdn, reasons, risks };
  }
  if (d.maxLatencyMs < 2000) {
    reasons.push("延迟预算 2s 内,纯 CDN 的秒级延迟不可接受,观众侧用 CDN + 主播侧用 RTC");
  }
  return { transport: "hybrid", expectedLatencyMs: LATENCY.hybrid, reasons, risks };
}

/** 粗算每小时出口流量成本:只看观众侧下行,RTC 按上行+转发双计 */
function estimateHourlyCost(d: Demand, transport: Transport) {
  const bitrateMbps = 4; // 1080p 约 3-5 Mbps
  const cdnPricePerGb = 0.2; // 元/GB,量级示意
  const viewerGb = (d.viewers * bitrateMbps * 3600) / 8 / 1024;
  if (transport === "cdn") return Math.round(viewerGb * cdnPricePerGb * d.regions);
  if (transport === "rtc") return Math.round(viewerGb * cdnPricePerGb * 4 * d.regions);
  const hosts = Math.min(d.viewers, 20);
  return Math.round((viewerGb * cdnPricePerGb + hosts * 0.5) * d.regions);
}

// ---- 断言 ----
const playback = select({ shape: "playback", viewers: 10_000, maxLatencyMs: 30_000, regions: 1, budgetYuanPerHour: 200 });
console.assert(playback.transport === "cdn", "点播走 CDN");
console.assert(playback.expectedLatencyMs === 8000, "CDN 延迟量级为秒级");
console.assert(playback.risks.length === 0, "点播且延迟预算宽松时无风险提示");

const oneToOne = select({ shape: "one-to-one", viewers: 2, maxLatencyMs: 500, regions: 1, budgetYuanPerHour: 50 });
console.assert(oneToOne.transport === "rtc", "一对一必须 RTC");
console.assert(oneToOne.expectedLatencyMs < 500, "RTC 延迟满足 500ms 预算");

const classOf = select({ shape: "interactive-class", viewers: 2000, maxLatencyMs: 1000, regions: 1, budgetYuanPerHour: 500 });
console.assert(classOf.transport === "hybrid", "大班课主播 RTC + 观众 CDN");
console.assert(
  classOf.risks.some((r) => r.includes("上台人数")),
  "千人大班必须提示连麦人数上限",
);

const richCommerce = select({ shape: "broadcast", viewers: 200_000, maxLatencyMs: 1500, regions: 2, budgetYuanPerHour: 200_000 });
console.assert(richCommerce.transport === "hybrid", "预算充足且延迟敏感时走混合");
console.assert(
  richCommerce.reasons.some((r) => r.includes("纯 CDN")),
  "选择混合需说明为什么不能纯 CDN",
);

const poorCommerce = select({ shape: "broadcast", viewers: 200_000, maxLatencyMs: 2000, regions: 2, budgetYuanPerHour: 200 });
console.assert(poorCommerce.transport === "cdn", "预算不足时退化为纯 CDN");
console.assert(poorCommerce.expectedLatencyMs === 8000, "退化后必须承认延迟变差");
console.assert(
  poorCommerce.risks.some((r) => r.includes("抢购")),
  "退化必须给出业务后果,而不是静默降级",
);

const crowd = select({ shape: "many-to-many", viewers: 30, maxLatencyMs: 400, regions: 1, budgetYuanPerHour: 100 });
console.assert(crowd.transport === "rtc", "多对多互动只能 RTC");
console.assert(crowd.risks.some((r) => r.includes("分房间")), "超 12 人需提示分房间");

console.log("✅ 延迟预算 / 互动强度 / 成本退化 / 风险提示全部通过");
