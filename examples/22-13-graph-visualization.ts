// 文件: examples/22-13-graph-visualization.ts
// ============ 图遍历可视化：BFS / DFS / Kahn 拓扑排序 ============
// 图的可视化帧只需要交三样东西：已访问集合、当前节点、队列/栈内容。
// 节点坐标由 UI 负责布局，算法不关心画在哪——职责分离后，同一份帧可以换任何渲染器。
// 运行方式：npx tsx examples/22-13-graph-visualization.ts

type Adjacency = Record<string, string[]>;

interface GraphFrame {
  visited: string[];
  active: string | null;
  frontier: string[];
  msg: string;
}

function buildGraph(edges: [string, string][]): Adjacency {
  const adj: Adjacency = {};
  const add = (from: string, to: string): void => {
    (adj[from] ??= []).push(to);
    adj[to] ??= [];
  };
  for (const [a, b] of edges) add(a, b);
  return adj;
}

/** BFS：队列逐层扩散，首次到达即最短（无权图） */
function bfs(adj: Adjacency, start: string): GraphFrame[] {
  const frames: GraphFrame[] = [];
  const visited = new Set<string>([start]);
  const queue = [start];
  const mark = (active: string | null, msg: string): void => {
    frames.push({ visited: [...visited], active, frontier: [...queue], msg });
  };
  mark(null, `起点 ${start} 入队`);
  while (queue.length) {
    const current = queue.shift()!;
    mark(current, `出队并访问 ${current}`);
    for (const next of adj[current] ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
      mark(next, `${next} 首次到达，入队`);
    }
  }
  return frames;
}

/** DFS：显式栈（逆序压栈保证按邻接表顺序访问），避免深图递归爆栈 */
function dfs(adj: Adjacency, start: string): GraphFrame[] {
  const frames: GraphFrame[] = [];
  const visited = new Set<string>();
  const stack = [start];
  const mark = (active: string | null, msg: string): void => {
    frames.push({ visited: [...visited], active, frontier: [...stack], msg });
  };
  mark(null, `起点 ${start} 压栈`);
  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current)) {
      mark(current, `${current} 已访问，跳过`);
      continue;
    }
    visited.add(current);
    mark(current, `访问 ${current}`);
    const neighbors = adj[current] ?? [];
    for (let i = neighbors.length - 1; i >= 0; i--) {
      if (!visited.has(neighbors[i])) stack.push(neighbors[i]);
    }
  }
  return frames;
}

/** Kahn：反复取出入度 0 的节点；输出不足 n 个即存在环 */
function topoSort(adj: Adjacency): { order: string[]; cycle: boolean } {
  const indegree = new Map<string, number>();
  for (const node of Object.keys(adj)) indegree.set(node, 0);
  for (const nexts of Object.values(adj))
    for (const next of nexts) indegree.set(next, (indegree.get(next) ?? 0) + 1);

  const queue = [...indegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([n]) => n);
  const order: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of adj[current] ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return { order, cycle: order.length !== indegree.size };
}

const edges: [string, string][] = [
  ["A", "B"],
  ["A", "C"],
  ["B", "D"],
  ["C", "D"],
  ["D", "E"],
];
const adj = buildGraph(edges);

const bfsFrames = bfs(adj, "A");
console.log(`=== BFS（${bfsFrames.length} 帧）===`);
for (const f of bfsFrames)
  console.log(
    `访问[${f.visited.join(",")}] 队列[${f.frontier.join(",")}] ${f.msg}`,
  );

const dfsFrames = dfs(adj, "A");
console.log(`\n=== DFS（${dfsFrames.length} 帧）===`);
for (const f of dfsFrames)
  console.log(
    `访问[${f.visited.join(",")}] 栈[${f.frontier.join(",")}] ${f.msg}`,
  );

const dag: Adjacency = buildGraph([
  ["先装依赖", "编译"],
  ["下载源码", "编译"],
  ["编译", "打包"],
  ["打包", "部署"],
]);
const topo = topoSort(dag);
console.log(
  `\n=== 拓扑排序 ===\n顺序: ${topo.order.join(" → ")}，有环: ${topo.cycle}`,
);

const cyclic = buildGraph([
  ["A", "B"],
  ["B", "C"],
  ["C", "A"],
]);
const cyclicTopo = topoSort(cyclic);
console.log(
  `循环依赖检测: 有环 ${cyclicTopo.cycle}，能排出的节点 ${cyclicTopo.order.length}`,
);

if (bfsFrames.at(-1)!.visited.length !== 5)
  throw new Error("BFS 未访问全部节点");
if (dfsFrames.at(-1)!.visited.length !== 5)
  throw new Error("DFS 未访问全部节点");
if (topo.cycle || topo.order.length !== 5) throw new Error("DAG 拓扑排序错误");
if (!cyclicTopo.cycle) throw new Error("循环依赖未被识别");

console.log("\n✓ BFS/DFS 全覆盖，DAG 可拓扑排序，环可检测");
