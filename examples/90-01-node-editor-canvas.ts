// 文件: examples/90-01-node-editor-canvas.ts
// ============ 可视化画布：节点/边模型 + 自动布局 + 连线校验 + 拖拽 ============
// 对应 JD「可视化画布/节点编辑器：React Flow、G6、X6，节点连线、拖拽缩放」。
// 纯 TS 演示图数据模型、DAG 校验、dagre 自动布局、连线合法性。硬断言直跑。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 图数据模型 ----------------

export interface NodeData {
  id: string;
  type: "input" | "process" | "output" | "condition";
  label: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  /** 条件分支的标签（如 "是/否"） */
  label?: string;
}

export interface Graph {
  nodes: NodeData[];
  edges: Edge[];
}

// ---------------- 2. DAG 校验：检测环 ----------------

/** 检测图中是否有环（工作流必须是 DAG，不能循环） */
export function hasCycle(graph: Graph): boolean {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    adj.get(e.source)?.push(e.target);
  }
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string): boolean {
    visited.add(node);
    inStack.add(node);
    for (const next of adj.get(node) || []) {
      if (!visited.has(next)) {
        if (dfs(next)) return true;
      } else if (inStack.has(next)) {
        return true; // 回边 = 有环
      }
    }
    inStack.delete(node);
    return false;
  }

  for (const n of graph.nodes) {
    if (!visited.has(n.id) && dfs(n.id)) return true;
  }
  return false;
}

// ---------------- 3. 连线合法性校验 ----------------

/**
 * 连线规则：
 * 1. 不能自连；
 * 2. 不能重复连线（同 source→target 只能一条，除非是条件分支）；
 * 3. 连线后不能形成环；
 * 4. output 节点不能作为 source（输出节点没有出边）；
 * 5. input 节点不能作为 target（输入节点没有入边）。
 */
export function canConnect(graph: Graph, source: string, target: string): { ok: boolean; reason?: string } {
  if (source === target) return { ok: false, reason: "不能自连" };
  const srcNode = graph.nodes.find((n) => n.id === source);
  const tgtNode = graph.nodes.find((n) => n.id === target);
  if (!srcNode || !tgtNode) return { ok: false, reason: "节点不存在" };
  if (srcNode.type === "output") return { ok: false, reason: "output 节点不能有出边" };
  if (tgtNode.type === "input") return { ok: false, reason: "input 节点不能有入边" };
  // 重复连线检查
  const dup = graph.edges.some((e) => e.source === source && e.target === target);
  if (dup) return { ok: false, reason: "已存在相同连线" };
  // 环检测：临时加边测试
  const testGraph: Graph = {
    nodes: graph.nodes,
    edges: [...graph.edges, { id: "test", source, target }],
  };
  if (hasCycle(testGraph)) return { ok: false, reason: "连线会形成环" };
  return { ok: true };
}

// ---------------- 4. 自动布局（简化版 dagre：分层布局） ----------------

/**
 * 简化的分层布局算法：
 * 1. 计算每个节点的层级（最长路径）；
 * 2. 同层节点水平排列，层间垂直排列；
 * 3. 返回每个节点的 position。
 * 真实场景用 dagre 库，这里演示核心逻辑。
 */
export function autoLayout(graph: Graph, nodeWidth = 160, nodeHeight = 60, hGap = 80, vGap = 100): Graph {
  // 计算每个节点的层级（从 input 节点开始的最长路径）
  const levels = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) adj.get(e.source)?.push(e.target);

  function getLevel(id: string, memo = new Map<string, number>()): number {
    if (memo.has(id)) return memo.get(id)!;
    const incoming = graph.edges.filter((e) => e.target === id);
    if (incoming.length === 0) {
      memo.set(id, 0);
      return 0;
    }
    const maxParentLevel = Math.max(...incoming.map((e) => getLevel(e.source, memo)));
    const level = maxParentLevel + 1;
    memo.set(id, level);
    return level;
  }

  for (const n of graph.nodes) levels.set(n.id, getLevel(n.id));

  // 按层分组
  const layerMap = new Map<number, NodeData[]>();
  for (const n of graph.nodes) {
    const lvl = levels.get(n.id)!;
    if (!layerMap.has(lvl)) layerMap.set(lvl, []);
    layerMap.get(lvl)!.push(n);
  }

  // 排列位置
  const maxLayer = Math.max(...levels.values());
  const positioned: NodeData[] = graph.nodes.map((n) => {
    const lvl = levels.get(n.id)!;
    const layerNodes = layerMap.get(lvl)!;
    const idx = layerNodes.findIndex((node) => node.id === n.id);
    const totalWidth = layerNodes.length * nodeWidth + (layerNodes.length - 1) * hGap;
    const startX = -totalWidth / 2;
    return {
      ...n,
      position: {
        x: startX + idx * (nodeWidth + hGap),
        y: lvl * (nodeHeight + vGap),
      },
    };
  });

  return { nodes: positioned, edges: graph.edges };
}

// ---------------- 5. 拖拽更新位置 ----------------

export function dragNode(graph: Graph, nodeId: string, dx: number, dy: number): Graph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
        : n,
    ),
  };
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. DAG 环检测 =====");
  const graph: Graph = {
    nodes: [
      { id: "a", type: "input", label: "开始", position: { x: 0, y: 0 }, width: 160, height: 60 },
      { id: "b", type: "process", label: "处理", position: { x: 0, y: 0 }, width: 160, height: 60 },
      { id: "c", type: "output", label: "结束", position: { x: 0, y: 0 }, width: 160, height: 60 },
    ],
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
    ],
  };
  assert(hasCycle(graph) === false, "a→b→c 无环");
  // 加一条 c→a 形成环
  const cyclic: Graph = { ...graph, edges: [...graph.edges, { id: "e3", source: "c", target: "a" }] };
  assert(hasCycle(cyclic) === true, "加 c→a 后形成环");
  console.log("✓ DAG 环检测：正常图无环，加回边后检测到环");

  console.log("\n===== 2. 连线合法性校验 =====");
  assert(canConnect(graph, "a", "c").ok === true, "a→c 可连（input→output 直接连）");
  assert(canConnect(graph, "a", "a").ok === false, "不能自连");
  assert(canConnect(graph, "c", "a").ok === false, "output 不能有出边");
  assert(canConnect(graph, "b", "a").ok === false, "input 不能有入边");
  assert(canConnect(graph, "a", "b").ok === false, "已存在连线不能重复");
  console.log("✓ 连线校验：自连/output出边/input入边/重复连线 都被拦截");

  console.log("\n===== 3. 自动布局 =====");
  const laid = autoLayout(graph);
  // a 在第 0 层，b 在第 1 层，c 在第 2 层
  const a = laid.nodes.find((n) => n.id === "a")!;
  const b = laid.nodes.find((n) => n.id === "b")!;
  const c = laid.nodes.find((n) => n.id === "c")!;
  assert(a.position.y === 0, "a 在第 0 层 y=0");
  assert(b.position.y > a.position.y, "b 在 a 下方");
  assert(c.position.y > b.position.y, "c 在 b 下方");
  console.log(`✓ 自动布局：a(${a.position.x},${a.position.y}) → b(${b.position.x},${b.position.y}) → c(${c.position.x},${c.position.y})`);

  console.log("\n===== 4. 节点拖拽 =====");
  const dragged = dragNode(graph, "b", 50, 30);
  const b2 = dragged.nodes.find((n) => n.id === "b")!;
  assert(b2.position.x === 50 && b2.position.y === 30, "拖拽后 b 位置更新");
  // 其他节点不变
  const a2 = dragged.nodes.find((n) => n.id === "a")!;
  assert(a2.position.x === 0, "拖拽 b 不影响 a");
  console.log("✓ 拖拽只更新目标节点，其他节点位置不变");

  console.log("\n✅ 图模型 + 环检测 + 连线校验 + 自动布局 + 拖拽全部通过");
}

main();
