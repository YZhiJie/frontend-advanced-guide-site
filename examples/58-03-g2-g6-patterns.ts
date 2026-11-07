/** 58-03-g2-g6-patterns.ts —— AntV G2/G6 数据管道验证 */
export function buildG2Spec(data: Array<Record<string, unknown>>, opts: { geom: string; x?: string; y?: string; color?: string; threshold?: number }) {
  const spec: Record<string, unknown> = { type: opts.geom, data, x: opts.x, y: opts.y, color: opts.color };
  if (opts.threshold !== undefined) spec.mark = { line: [{ y: opts.threshold }] };
  return spec;
}
export function buildG6RiskGraph(nodes: Array<{ id: string; label: string; risk: string }>, edges: Array<[string, string]>) {
  return { nodes: nodes.map((n) => ({ id: n.id, label: n.label, risk: n.risk })), edges: edges.map(([s, t]) => ({ source: s, target: t })) };
}
const data = [{ category: "周一", qps: 150, api: "A" }];
const spec = buildG2Spec(data, { geom: "interval", x: "category", y: "qps", color: "api", threshold: 180 });
console.assert(spec.type === "interval", "G2 geom OK");
console.assert((spec.mark as any).line.length === 1, "G2 threshold OK");
const graph = buildG6RiskGraph([{ id: "u1", label: "A", risk: "high" }, { id: "d1", label: "B", risk: "medium" }], [["u1", "d1"]]);
console.assert(graph.nodes.length === 2 && graph.edges.length === 1, "G6 图构建 OK");
console.log("✅ AntV G2/G6 数据管道验证通过");
