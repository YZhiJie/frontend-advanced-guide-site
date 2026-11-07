/** 59-03-session-recorder.ts —— 会话回放录制器 */
export function isSensitiveInput(type: string, name: string): boolean {
  return type === "password" || /credit|card|cvv|secret|token|pass/i.test(name);
}
export class SessionRecorder {
  private events: Array<{ type: string; timestamp: number; payload: unknown }> = [];
  private paused = false;
  record(type: string, payload: unknown) { if (!this.paused) this.events.push({ type, timestamp: Date.now(), payload }); }
  pauseOnSensitive(attrs: { type?: string; name?: string }) { this.paused = isSensitiveInput(attrs.type || "", attrs.name || ""); }
  getEventCount() { return this.events.length; }
}
const rec = new SessionRecorder();
rec.record("click", { selector: "#btn" }); rec.record("route", { to: "/x" });
console.assert(rec.getEventCount() === 2, "记录 2 个事件");
console.assert(isSensitiveInput("password", "pwd"), "password 敏感");
rec.pauseOnSensitive({ type: "password", name: "pwd" });
rec.record("click", { selector: "#save" });
console.assert(rec.getEventCount() === 2, "暂停期间不记录");
rec.pauseOnSensitive({ type: "text", name: "username" });
rec.record("click", { selector: "#save" });
console.assert(rec.getEventCount() === 3, "恢复后记录");
console.log("✅ 会话回放录制器测试通过");
