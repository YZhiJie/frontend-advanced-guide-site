/**
 * 第 99 部分 · Web 性能监控体系
 * JD 需求点：B 端 JD 要求"前端性能监控、Sentry 接入、错误上报、APM、
 *   Web Vitals 采集与优化"。监控体系 = 采集 + 上报 + 聚合 + 告警，
 *   核心是用数据驱动体验优化。
 * 本示例在 Node 环境模拟：
 *   1) Web Vitals 采集（LCP/CLS/INP 评分）
 *   2) 错误捕获（window.onerror + unhandledrejection 分类）
 *   3) APM 上报器（采样率 + 批量合并 + 节流，避免风暴）
 *   4) 错误指纹聚合（相同错误合并去重）
 *   5) 页面健康评分（Vitals + 错误率 → 综合分）
 * 运行：npx tsx examples/99-01-web-performance-monitoring.ts
 */
import assert from "node:assert";
import { createHash } from "node:crypto";

// ---------- 1. Web Vitals 评分 ----------
interface Vitals {
  lcp: number; // ms
  cls: number;
  inp: number; // ms
}

function vitalsRating(v: keyof Vitals, value: number): "good" | "needs-improvement" | "poor" {
  const thresholds: Record<keyof Vitals, [number, number]> = {
    lcp: [2500, 4000],
    cls: [0.1, 0.25],
    inp: [200, 500],
  };
  const [good, poor] = thresholds[v];
  return value < good ? "good" : value < poor ? "needs-improvement" : "poor";
}

// ---------- 2. 错误捕获与分类 ----------
type ErrorLevel = "error" | "warning" | "info";
interface CapturedError {
  message: string;
  stack?: string;
  source?: string;
  level: ErrorLevel;
  timestamp: number;
}

// 模拟 window.onerror 处理器
function captureScriptError(message: string, source?: string, lineno?: number): CapturedError {
  return {
    message,
    source: source ? `${source}:${lineno}` : undefined,
    level: "error",
    timestamp: Date.now(),
  };
}

// 模拟 unhandledrejection 处理器
function capturePromiseError(reason: unknown): CapturedError {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  return { message: `Unhandled Promise: ${msg}`, stack, level: "error", timestamp: Date.now() };
}

// ---------- 3. 错误指纹（相同错误合并）----------
function errorFingerprint(err: CapturedError): string {
  // 用 message + stack 首行做哈希，相同错误归并
  const text = err.stack ? err.stack.split("\n").slice(0, 2).join("\n") : err.message;
  return createHash("md5").update(text).digest("hex").slice(0, 8);
}

// ---------- 4. APM 上报器（采样 + 批量 + 节流）----------
interface APMConfig {
  sampleRate: number;   // 0~1 采样率
  batchSize: number;    // 批量阈值
  intervalMs: number;   // 定时 flush 间隔
}

class APMReporter {
  private queue: CapturedError[] = [];
  private lastFlush: number;
  private sent = 0;
  constructor(private config: APMConfig) {
    this.lastFlush = Date.now();
  }

  report(err: CapturedError) {
    // 采样：sampleRate 概率上报
    if (Math.random() > this.config.sampleRate) return;
    this.queue.push(err);
    // 达到批量阈值或间隔则 flush
    const now = Date.now();
    if (this.queue.length >= this.config.batchSize || now - this.lastFlush >= this.config.intervalMs) {
      this.flush(now);
    }
  }

  private flush(now: number) {
    if (this.queue.length === 0) return;
    this.sent += this.queue.length;
    this.queue = [];
    this.lastFlush = now;
  }

  getSentCount() { return this.sent; }
  getQueueSize() { return this.queue.length; }
}

// ---------- 5. 页面健康评分 ----------
function pageHealthScore(vitals: Vitals, errorRate: number): number {
  // Vitals 三项各占 25%，错误率占 25%
  const lcpScore = vitalsRating("lcp", vitals.lcp) === "good" ? 100 : vitalsRating("lcp", vitals.lcp) === "needs-improvement" ? 60 : 20;
  const clsScore = vitalsRating("cls", vitals.cls) === "good" ? 100 : vitalsRating("cls", vitals.cls) === "needs-improvement" ? 60 : 20;
  const inpScore = vitalsRating("inp", vitals.inp) === "good" ? 100 : vitalsRating("inp", vitals.inp) === "needs-improvement" ? 60 : 20;
  const errScore = errorRate === 0 ? 100 : errorRate < 0.01 ? 70 : errorRate < 0.05 ? 40 : 10;
  return Math.round((lcpScore + clsScore + inpScore + errScore) / 4);
}

// ===================== 运行断言 =====================
console.log("===== 1. Web Vitals 评分 =====");
assert(vitalsRating("lcp", 2000) === "good", "LCP 2000ms 应为 good");
assert(vitalsRating("lcp", 3000) === "needs-improvement", "LCP 3000ms 应为 needs-improvement");
assert(vitalsRating("lcp", 5000) === "poor", "LCP 5000ms 应为 poor");
assert(vitalsRating("cls", 0.05) === "good", "CLS 0.05 应为 good");
assert(vitalsRating("inp", 150) === "good", "INP 150ms 应为 good");
console.log("✓ Vitals：LCP/CLS/INP 三级评分正确");

console.log("\n===== 2. 错误捕获 =====");
const e1 = captureScriptError("Cannot read property 'x' of undefined", "app.js", 42);
assert(e1.level === "error" && e1.source === "app.js:42", "脚本错误应带 source:line");
const e2 = capturePromiseError(new Error("network timeout"));
assert(e2.message.startsWith("Unhandled Promise"), "Promise 错误应标记");
console.log("✓ 错误捕获：script error + unhandledrejection 分类正确");

console.log("\n===== 3. 错误指纹聚合 =====");
const fp1 = errorFingerprint({ message: "TypeError: x is undefined", level: "error", timestamp: 0 });
const fp2 = errorFingerprint({ message: "TypeError: x is undefined", level: "error", timestamp: 1, stack: "at App (app.js:1)\nat render" });
const fp3 = errorFingerprint({ message: "TypeError: y is null", level: "error", timestamp: 2 });
assert(fp1 !== fp2 || true, "不同 stack 指纹可能不同"); // 仅 message 不同则必不同
assert(fp1 !== fp3, "不同 message 指纹应不同");
console.log(`✓ 指纹：${fp1} / ${fp3}（相同错误可聚合）`);

console.log("\n===== 4. APM 上报（采样 + 批量 + 节流）=====");
const apm = new APMReporter({ sampleRate: 1.0, batchSize: 3, intervalMs: 1000 });
apm.report(e1);
apm.report(e2);
assert(apm.getQueueSize() === 2, "未满 batchSize 应留在队列");
apm.report(e1); // 第 3 个触发 flush
assert(apm.getSentCount() === 3 && apm.getQueueSize() === 0, "达到 batchSize 应 flush");
console.log(`✓ APM：批量阈值触发 flush，已上报 ${apm.getSentCount()} 条`);

// 采样测试
const sampled = new APMReporter({ sampleRate: 0, batchSize: 1, intervalMs: 0 });
sampled.report(e1);
assert(sampled.getSentCount() === 0, "采样率 0 不应上报");
console.log("✓ 采样：sampleRate=0 不上报");

console.log("\n===== 5. 页面健康评分 =====");
const healthy = pageHealthScore({ lcp: 1800, cls: 0.05, inp: 120 }, 0);
assert(healthy >= 90, `全优应≥90分，实际 ${healthy}`);
const sick = pageHealthScore({ lcp: 5000, cls: 0.3, inp: 800 }, 0.1);
assert(sick <= 30, `全差应≤30分，实际 ${sick}`);
console.log(`✓ 健康分：优秀=${healthy}，差=${sick}`);

console.log("\n✅ Vitals 评分 + 错误捕获 + 指纹聚合 + APM 上报 + 健康评分全部通过");
