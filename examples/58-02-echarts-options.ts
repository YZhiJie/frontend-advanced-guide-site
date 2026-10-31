/** 58-02-echarts-options.ts —— ECharts options 构建器 */
interface SeriesLine { type: "line"; name: string; data: number[]; smooth?: boolean; areaStyle?: unknown; markPoint?: unknown; markLine?: unknown; }
export const DARK_PALETTE = ["#00d4ff", "#ff6b6b", "#ffd93d", "#6bcb77", "#c792ea", "#ff9f43"];
export function buildLineChart(
  title: string, categories: string[],
  series: Array<{ name: string; data: number[]; smooth?: boolean }>,
  opts?: { thresholdLine?: number; peakMark?: boolean; area?: boolean }
) {
  const lineSeries: SeriesLine[] = series.map((s) => {
    const item: SeriesLine = { type: "line", name: s.name, data: s.data, smooth: s.smooth ?? true };
    if (opts?.area) item.areaStyle = { opacity: 0.15 };
    if (opts?.peakMark) { const m = s.data.indexOf(Math.max(...s.data)); item.markPoint = { data: [{ coord: [m, s.data[m]], value: "峰值" }] }; }
    if (opts?.thresholdLine !== undefined) { item.markLine = { data: [{ yAxis: opts.thresholdLine!, label: { formatter: "告警阈值: {c}" } }] }; }
    return item;
  });
  return { title: { text: title }, tooltip: { trigger: "axis" }, legend: { data: series.map((s) => s.name) }, series: lineSeries, color: DARK_PALETTE };
}
const opts = buildLineChart("QPS", ["0", "1", "2"], [{ name: "API-1", data: [100, 200, 300] }, { name: "API-2", data: [50, 100, 150] }], { thresholdLine: 250, peakMark: true, area: true });
console.assert(opts.series.length === 2, "2 个 series");
console.assert((opts.series[0] as SeriesLine).markLine !== undefined, "有 markLine");
console.log("✅ ECharts options 构建器通过");
