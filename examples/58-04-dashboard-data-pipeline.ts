/** 58-04-dashboard-data-pipeline.ts —— 风控看板数据管道版本守卫 */
import { EventEmitter } from "node:events";
class DashboardDataBus extends EventEmitter {
  private version = 0;
  private trend: Array<{ version: number }> = [];
  private readonly MAX_TREND = 60;
  handleIncoming<T extends { version: number }>(pkg: T): T | null {
    if (pkg.version <= this.version) return null;
    this.version = pkg.version;
    return pkg;
  }
  appendTrend(raw: { version: number }) {
    const pkg = this.handleIncoming(raw);
    if (!pkg) return;
    this.trend.push(pkg);
    if (this.trend.length > this.MAX_TREND) this.trend = this.trend.slice(-this.MAX_TREND);
  }
  getTrend() { return this.trend; }
}
const bus = new DashboardDataBus();
bus.appendTrend({ version: 1 }); bus.appendTrend({ version: 2 }); bus.appendTrend({ version: 3 });
console.assert(bus.getTrend().length === 3, "追加 3 个");
bus.appendTrend({ version: 2 }); // 过期
console.assert(bus.getTrend().length === 3, "过期被丢弃");
console.log("✅ DataBus 版本守卫通过");
