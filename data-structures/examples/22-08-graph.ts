/**
 * 22-08-graph.ts —— 图（Graph）
 * 对应主文档：第二十二部分 22.7 图
 *
 * 内容清单：
 *   1. Graph<T> 邻接表（Map<T, T[]>）：addVertex / addEdge（支持有向与无向）
 *   2. BFS 广度优先遍历（队列）
 *   3. DFS 深度优先遍历（迭代版——避免递归爆栈）
 *   4. Kahn 拓扑排序（入度表 + 队列；检测到有环时返回 null）
 *   5. demo：前端模块依赖图输出打包顺序 + 构造循环依赖验证检测
 *
 * 运行方式：npx tsx data-structures/examples/22-08-graph.ts
 */

// ============================================================
// 一、邻接表实现
// ============================================================

/**
 * 为什么用邻接表而不是邻接矩阵：
 * 前端依赖图是稀疏图（边数远小于顶点数²），邻接矩阵 O(V²) 空间太浪费；
 * 邻接表 O(V + E)，且 Map<T, T[]> 天然支持任意类型顶点（字符串模块名等）。
 */
class Graph<T> {
  private adjacencyList = new Map<T, T[]>();

  addVertex(vertex: T): void {
    if (!this.adjacencyList.has(vertex)) {
      this.adjacencyList.set(vertex, []);
    }
  }

  /**
   * 加边。directed = false 时双向加边（无向图）。
   * 自动补全不存在的顶点——建图时少一步手动 addVertex 的样板代码。
   */
  addEdge(from: T, to: T, directed = false): void {
    this.addVertex(from);
    this.addVertex(to);
    this.adjacencyList.get(from)!.push(to);
    if (!directed) {
      this.adjacencyList.get(to)!.push(from);
    }
  }

  /** 返回顶点的邻居列表（副本，防止外部篡改内部状态） */
  getNeighbors(vertex: T): T[] {
    return [...(this.adjacencyList.get(vertex) ?? [])];
  }

  vertexCount(): number {
    return this.adjacencyList.size;
  }

  hasVertex(vertex: T): boolean {
    return this.adjacencyList.has(vertex);
  }

  // ============================================================
  // 二、BFS 广度优先
  // ============================================================

  /**
   * 队列实现，逐层扩散。
   * 适用：最短路径（无权图）、层级遍历、「N 度好友」类问题。
   */
  bfs(start: T): T[] {
    const result: T[] = [];
    if (!this.adjacencyList.has(start)) return result;
    const visited = new Set<T>([start]); // 入队即标记，防重复入队
    const queue: T[] = [start];
    while (queue.length > 0) {
      const vertex = queue.shift()!; // 教学可读优先；生产应换环形队列
      result.push(vertex);
      for (const neighbor of this.adjacencyList.get(vertex)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor); // 必须在入队时标记，出队才标记会导致同一节点多次入队
          queue.push(neighbor);
        }
      }
    }
    return result;
  }

  // ============================================================
  // 三、DFS 深度优先（迭代版）
  // ============================================================

  /**
   * 显式栈实现。为什么不写递归版：
   * V8 默认调用栈深度约 1 万层，万级节点的深层图递归会直接
   * RangeError: Maximum call stack size exceeded——生产代码用迭代更稳。
   * 注意压栈顺序：逆序压栈才能让邻居按原始顺序弹出访问。
   */
  dfs(start: T): T[] {
    const result: T[] = [];
    if (!this.adjacencyList.has(start)) return result;
    const visited = new Set<T>();
    const stack: T[] = [start];
    while (stack.length > 0) {
      const vertex = stack.pop()!;
      if (visited.has(vertex)) continue; // 栈中可能有重复，跳过
      visited.add(vertex);
      result.push(vertex);
      const neighbors = this.adjacencyList.get(vertex)!;
      // 逆序压栈：栈是 LIFO，倒着压才能正着访问
      for (let i = neighbors.length - 1; i >= 0; i--) {
        if (!visited.has(neighbors[i])) {
          stack.push(neighbors[i]);
        }
      }
    }
    return result;
  }

  // ============================================================
  // 四、Kahn 拓扑排序（BFS 版）
  // ============================================================

  /**
   * 只对有向图有意义。算法：
   *   1. 统计每个顶点的入度；
   *   2. 入度为 0 的顶点（没有前置依赖）入队；
   *   3. 每弹出一个顶点就输出它，并把它所有邻居的入度 -1，
   *      邻居入度归零时入队；
   *   4. 若输出数 < 顶点数，说明有环——环上顶点入度永远不为 0，进不了队。
   * 返回拓扑序列；检测到环返回 null。
   */
  topologicalSort(): T[] | null {
    const inDegree = new Map<T, number>();
    for (const vertex of this.adjacencyList.keys()) {
      inDegree.set(vertex, 0);
    }
    for (const neighbors of this.adjacencyList.values()) {
      for (const neighbor of neighbors) {
        inDegree.set(neighbor, (inDegree.get(neighbor) ?? 0) + 1);
      }
    }

    const queue: T[] = [];
    for (const [vertex, degree] of inDegree) {
      if (degree === 0) queue.push(vertex); // 无依赖的先处理
    }

    const result: T[] = [];
    while (queue.length > 0) {
      const vertex = queue.shift()!;
      result.push(vertex);
      for (const neighbor of this.adjacencyList.get(vertex)!) {
        const newDegree = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor); // 依赖全部就位，可以处理了
      }
    }

    if (result.length !== this.adjacencyList.size) {
      // 有顶点没进过队 → 存在环，无法拓扑排序
      console.warn(
        `⚠️ 检测到循环依赖：${this.adjacencyList.size - result.length} 个顶点无法排序`,
      );
      return null;
    }
    return result;
  }
}

// ============================================================
// 五、自测断言
// ============================================================

// --- 无向图 BFS / DFS ---
//       A
//      / \
//     B   C
//     |   |
//     D   E
const g = new Graph<string>();
g.addEdge("A", "B");
g.addEdge("A", "C");
g.addEdge("B", "D");
g.addEdge("C", "E");

console.assert(g.vertexCount() === 5, "应有 5 个顶点");
console.assert(
  JSON.stringify(g.bfs("A")) === '["A","B","C","D","E"]',
  "BFS 应逐层访问",
);
console.assert(
  JSON.stringify(g.dfs("A")) === '["A","B","D","C","E"]',
  "DFS 应先纵深再回溯",
);
console.assert(
  JSON.stringify(g.bfs("不存在")) === "[]",
  "起点不存在应返回空数组",
);
console.assert(
  JSON.stringify(g.dfs("不存在")) === "[]",
  "DFS 起点不存在应返回空数组",
);
console.assert(
  JSON.stringify(g.getNeighbors("B")) === '["A","D"]',
  "B 的邻居应为 A 和 D",
);
// 副本保护：改返回值不影响图内部
const neighbors = g.getNeighbors("B");
neighbors.push("篡改");
console.assert(
  JSON.stringify(g.getNeighbors("B")) === '["A","D"]',
  "getNeighbors 应返回副本防篡改",
);

// --- 有向图 ---
const dg = new Graph<string>();
dg.addEdge("A", "B", true);
dg.addEdge("B", "A", false); // 无向再加一条，B 的邻居应有 A 出现两次？不——有向无向混用属误用场景
console.assert(
  dg.hasVertex("A") && dg.hasVertex("B"),
  "addEdge 应自动补全顶点",
);

// --- demo：前端模块依赖图，输出打包顺序 ---
// 依赖语义：X -> Y 表示「X 依赖 Y」，Y 必须先于 X 打包。
// 用反向建边：Y -> X，拓扑序即「先被依赖的先打包」。
const deps = new Graph<string>();
// app 依赖 router 和 store；router 依赖 store；store 依赖 utils；router 还依赖 utils
const rawDeps: [string, string][] = [
  ["app", "router"],
  ["app", "store"],
  ["router", "store"],
  ["router", "utils"],
  ["store", "utils"],
];
for (const [mod, dep] of rawDeps) {
  deps.addEdge(dep, mod, true); // 反向边：被依赖者指向依赖者
}
const buildOrder = deps.topologicalSort();
console.assert(buildOrder !== null, "无环依赖图应能排出拓扑序");
console.log(`📦 模块打包顺序：${(buildOrder ?? []).join(" -> ")}`);
// 拓扑序合法性通用校验：每条原始依赖 (mod 依赖 dep)，dep 必须排在 mod 前面
const position = new Map<string, number>();
(buildOrder ?? []).forEach((mod, i) => position.set(mod, i));
let validOrder = true;
for (const [mod, dep] of rawDeps) {
  if (position.get(dep)! > position.get(mod)!) validOrder = false;
}
console.assert(validOrder, "所有依赖都必须排在使用者之前");
console.assert(position.get("utils") === 0, "utils 无依赖，应最先打包");
console.assert(position.get("app") === 3, "app 依赖最多，应最后打包");

// --- 循环依赖检测 ---
const cycle = new Graph<string>();
cycle.addEdge("A", "B", true);
cycle.addEdge("B", "C", true);
cycle.addEdge("C", "A", true); // 成环
cycle.addEdge("C", "D", true); // D 在环外，也受牵连无法排序
const cycleResult = cycle.topologicalSort();
console.assert(cycleResult === null, "有环图拓扑排序应返回 null");

// --- 边界：单顶点图、空图 ---
const single = new Graph<string>();
single.addVertex("孤独顶点");
console.assert(
  JSON.stringify(single.topologicalSort()!) === '["孤独顶点"]',
  "单顶点拓扑序应为其自身",
);
console.assert(
  JSON.stringify(single.bfs("孤独顶点")) === '["孤独顶点"]',
  "单顶点 BFS 应只含自身",
);
const emptyGraph = new Graph<string>();
console.assert(
  JSON.stringify(emptyGraph.topologicalSort()!) === "[]",
  "空图拓扑序应为空数组",
);
console.assert(emptyGraph.vertexCount() === 0, "空图顶点数应为 0");

console.log("✅ 22-08 graph 全部断言通过");

export {};
