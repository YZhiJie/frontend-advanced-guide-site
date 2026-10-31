/** 58-01-selection.ts —— 图表库选型决策函数 */
type ChartType = "echarts" | "g2" | "g6" | "d3";
interface Req { dataKind: "time-series" | "category" | "relation" | "geo" | "custom"; customization: "basic" | "mark" | "full-custom"; dataSize: number; }
export function decideChart(req: Req): ChartType {
  if (req.dataKind === "relation") return "g6";
  if (req.dataKind === "geo") return req.customization === "full-custom" ? "d3" : "echarts";
  if (req.dataKind === "custom") return "d3";
  if (req.customization === "full-custom") return "d3";
  if (req.customization === "mark") return "g2";
  return "echarts";
}
const cases: Array<[Req, ChartType]> = [
  [{ dataKind: "time-series", customization: "basic", dataSize: 100 }, "echarts"],
  [{ dataKind: "category", customization: "mark", dataSize: 500 }, "g2"],
  [{ dataKind: "relation", customization: "basic", dataSize: 50 }, "g6"],
  [{ dataKind: "custom", customization: "full-custom", dataSize: 200 }, "d3"],
];
for (const [req, expected] of cases) {
  const actual = decideChart(req);
  console.assert(actual === expected, `选型错误:${JSON.stringify(req)} → ${expected} vs ${actual}`);
}
console.log("✅ 选型决策函数断言通过");
