// 分层依赖审计：把「上层可依赖下层、下层绝不感知上层」变成可检查的规则。
// 真实项目里这份 import 映射来自 dependency-cruiser / eslint-plugin-import；
// 这里用数据演示检查逻辑本身——架构约束必须可执行，否则必然腐化。

type Layer = "views" | "features" | "services" | "infra";

// 层级秩：数值越大越靠上层；上层依赖下层（from.rank > to.rank）合法
const RANK: Record<Layer, number> = {
  infra: 0,
  services: 1,
  features: 2,
  views: 3,
};

interface Dep {
  from: `${Layer}/${string}`;
  to: `${Layer}/${string}`;
}

const deps: Dep[] = [
  { from: "views/order", to: "features/order" }, // 正常：上层用业务层
  { from: "features/order", to: "services/order-api" }, // 正常
  { from: "services/order-api", to: "infra/request" }, // 正常
  { from: "views/order", to: "infra/request" }, // 跨层直达：方向对，但绕过了服务层（警告）
  { from: "infra/request", to: "features/cart" }, // 反向依赖：基建感知了业务（违规）
  { from: "features/cart", to: "features/order" }, // 同层互依：演变成环的温床（违规）
];

const layerOf = (mod: `${Layer}/${string}`): Layer =>
  mod.split("/")[0] as Layer;

// 1) 反向依赖：低秩模块 import 高秩模块
// 2) 跨层直达：方向正确但跳层（views→infra），绕过中间层的封装
// 3) 同层互依：层内横向依赖，是循环依赖的前兆
const violations: string[] = [];
const warnings: string[] = [];
for (const { from, to } of deps) {
  const a = RANK[layerOf(from)];
  const b = RANK[layerOf(to)];
  if (a < b) violations.push(`反向依赖：${from} → ${to}（下层感知了上层）`);
  else if (layerOf(from) === layerOf(to))
    violations.push(`同层互依：${from} → ${to}`);
  else if (a - b > 1)
    warnings.push(`跨层直达：${from} → ${to}（绕过中间层封装）`);
}

// 4) 循环依赖：DFS 找环（这里展示判定，真实项目交给 import/no-cycle）
const graph = new Map<string, string[]>();
for (const { from, to } of deps) {
  if (!graph.has(from)) graph.set(from, []);
  graph.get(from)!.push(to);
}
const cycles: string[] = [];
const seenCycles = new Set<string>();
for (const start of graph.keys()) {
  const stack: string[] = [];
  const visit = (node: string): void => {
    if (stack.includes(node)) {
      // 规范化：旋转到字典序最小的节点，同一个环只报告一次
      const path = [...stack.slice(stack.indexOf(node)), node];
      const nodes = path.slice(0, -1);
      const pivot = nodes.indexOf([...nodes].sort()[0]);
      const canon = [
        ...nodes.slice(pivot),
        ...nodes.slice(0, pivot),
        nodes[pivot],
      ].join(" → ");
      if (!seenCycles.has(canon)) {
        seenCycles.add(canon);
        cycles.push(canon);
      }
      return;
    }
    stack.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    stack.pop();
  };
  visit(start);
}

console.log(
  violations.length
    ? violations.map((v) => `✗ ${v}`).join("\n")
    : "✓ 无违规依赖",
);
console.log(
  warnings.length ? warnings.map((w) => `⚠ ${w}`).join("\n") : "✓ 无跨层直达",
);
console.log(
  cycles.length
    ? `✗ 检测到环：\n${cycles.map((c) => `  ${c}`).join("\n")}`
    : "✓ 无循环依赖",
);
