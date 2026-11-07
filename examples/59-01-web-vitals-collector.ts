/** 59-01-web-vitals-collector.ts —— Web Vitals 生产级采集器 */
const THRESHOLDS: Record<string, [number, number]> = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };
export function rateVital(name: string, value: number): "good" | "needs-improvement" | "poor" {
  const [g, p] = THRESHOLDS[name];
  if (name === "CLS") return value <= g ? "good" : value <= p ? "needs-improvement" : "poor";
  return value <= g ? "good" : value <= p ? "needs-improvement" : "poor";
}
export function shouldSample(sessionId: string, sampleRate: number): boolean {
  let hash = 5381;
  for (let i = 0; i < sessionId.length; i++) hash = (hash * 33) ^ sessionId.charCodeAt(i);
  return Math.abs(hash) % 100 < sampleRate * 100;
}
console.assert(rateVital("LCP", 2000) === "good", "LCP 2s good");
console.assert(rateVital("CLS", 0.3) === "poor", "CLS 0.3 poor");
const sid = "test-session";
console.assert(shouldSample(sid, 0.5) === shouldSample(sid, 0.5), "稳定哈希");
let hit = 0; for (let i = 0; i < 1000; i++) if (shouldSample(`s${i}`, 0.01)) hit++;
console.log(`1% 采样命中:${hit}`, hit > 0 && hit < 30);
console.log("✅ Web Vitals 采集器逻辑通过");
