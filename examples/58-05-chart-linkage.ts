/** 58-05-chart-linkage.ts —— 图表联动事件管道 */
export class LinkageBus {
  private filters: Map<string, Record<string, string | number>> = new Map();
  publish(source: string, action: string, params: { name?: string }) {
    const merged: Record<string, string | number> = {};
    for (const f of this.filters.values()) Object.assign(merged, f);
    this.filters.set(source, action === "click" && params.name ? { [source === "pie" ? "attackType" : source === "bar" ? "region" : "date"]: params.name } : {});
    for (const f of this.filters.values()) Object.assign(merged, f);
    return merged;
  }
  clearFilter(source: string) { this.filters.delete(source); }
  getFilters() { return [...this.filters.values()].reduce((acc, f) => ({ ...acc, ...f }), {}); }
}
const bus = new LinkageBus();
bus.publish("line", "click", { name: "2026-10-23" });
console.assert(bus.getFilters().date === "2026-10-23", "有 date filter");
bus.publish("pie", "click", { name: "SQL 注入" });
console.assert(bus.getFilters().attackType === "SQL 注入", "有 attackType filter");
bus.clearFilter("line");
console.assert(bus.getFilters().date === undefined, "清除后无 date");
console.log("✅ 图表联动事件管道通过");
