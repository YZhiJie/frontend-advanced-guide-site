/** 59-02-error-fingerprint.ts —— 错误指纹聚合 */
import { createHash } from "crypto";
function normalizeStack(lines: string[]): string[] {
  return lines.map((line) => {
    const m = line.match(/at\s+(.+?)\s+\((.+?):\d+:\d+\)|at\s+(.+?):\d+:\d+/);
    if (m) {
      const fn = m[1] || "(anonymous)";
      const file = (m[2] || m[3] || "unknown").split("/").pop()!.replace(/\.[a-f0-9]{8,}/g, "");
      return `${fn}@${file}`;
    }
    return line.trim();
  }).slice(0, 5);
}
export function computeFingerprint(type: string, message: string, stackLines: string[]): string {
  const msg = message
    .replace(/\b\d{10,}\b/g, "<NUM>")
    .replace(/[a-f0-9]{32,}/g, "<HEX>")
    .replace(/https?:\/\/[^\s]*/g, "<URL>");
  return createHash("md5").update(`${type}:${msg}:${normalizeStack(stackLines).join("|")}`).digest("hex");
}
export class RateLimiter {
  private sent = new Map<string, number>();
  constructor(private windowMs: number) {}
  shouldSend(fp: string): boolean {
    const now = Date.now();
    const last = this.sent.get(fp) ?? 0;
    if (now - last > this.windowMs) { this.sent.set(fp, now); return true; }
    return false;
  }
}
const fp1 = computeFingerprint("TypeError", "Cannot read 'map' of undefined", ["at fn1 (a.js:1:2345)"]);
const fp2 = computeFingerprint("TypeError", "Cannot read 'map' of undefined", ["at fn1 (a.js:1:3456)"]);
console.assert(fp1 === fp2, "同类错误指纹一致 ✅ fp=" + fp1);
const limiter = new RateLimiter(5000);
console.assert(limiter.shouldSend(fp1), "第一次发送");
console.assert(!limiter.shouldSend(fp1), "窗口内限流");
console.log("✅ 错误指纹聚合通过");
