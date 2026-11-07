// 文件: examples/125-01-graph-model.ts
// 图数据契约：Node/Edge/类型字典、id 唯一性与悬空边校验、多重边合并、入度出度统计
// 目标：前端拿到的任何图数据都必须先过契约校验；不合规数据直接拒绝，不带着脏数据进布局与渲染

import assert from 'node:assert';

/** 节点类型字典：与后端本体（ontology）对齐，字典外类型一律拒绝 */
const NODE_TYPES = ['doc', 'person', 'tag', 'concept'] as const;
type NodeType = (typeof NODE_TYPES)[number];

/** 边类型字典：语义化关系，渲染颜色与箭头都由类型驱动 */
const EDGE_TYPES = ['references', 'authored', 'tagged', 'related'] as const;
type EdgeType = (typeof EDGE_TYPES)[number];

interface GraphNode {
    id: string;
    type: NodeType;
    label: string;
    /** 业务权重，用于布局半径与 LOD 排序；缺省 1 */
    weight?: number;
}

interface GraphEdge {
    id: string;
    source: string;
    target: string;
    type: EdgeType;
    /** 关系强度，多重边合并时累加 */
    weight: number;
}

interface DegreeStat {
    inDegree: number;
    outDegree: number;
}

/** 校验原始节点：类型字典、id 唯一性、label 非空 */
function validateNodes(rawNodes: GraphNode[]): Map<string, GraphNode> {
    const nodeMap = new Map<string, GraphNode>();
    for (const node of rawNodes) {
        if (!node.id || typeof node.id !== 'string') {
            throw new Error(`E_NODE_ID: 节点缺少合法 id`);
        }
        if (nodeMap.has(node.id)) {
            throw new Error(`E_DUP_NODE: 节点 id 重复 ${node.id}`);
        }
        if (!NODE_TYPES.includes(node.type)) {
            throw new Error(`E_NODE_TYPE: 未知节点类型 ${node.type}`);
        }
        if (!node.label || node.label.trim().length === 0) {
            throw new Error(`E_NODE_LABEL: 节点 ${node.id} 缺少 label`);
        }
        nodeMap.set(node.id, { ...node, weight: node.weight ?? 1 });
    }
    return nodeMap;
}

/**
 * 校验并归一化边：
 * 1. 类型必须在字典内；
 * 2. 两端节点必须存在（悬空边直接拒绝，不让渲染期才发现箭头指向空气）；
 * 3. 同 source+target+type 的多重边合并为一条，weight 累加并记录合并数。
 */
function normalizeEdges(rawEdges: GraphEdge[], nodeMap: Map<string, GraphNode>): GraphEdge[] {
    const merged = new Map<string, GraphEdge & { mergedCount: number }>();
    for (const edge of rawEdges) {
        if (!EDGE_TYPES.includes(edge.type)) {
            throw new Error(`E_EDGE_TYPE: 未知边类型 ${edge.type}`);
        }
        if (!nodeMap.has(edge.source)) {
            throw new Error(`E_DANGLING: 边 ${edge.id} 的 source ${edge.source} 不存在`);
        }
        if (!nodeMap.has(edge.target)) {
            throw new Error(`E_DANGLING: 边 ${edge.id} 的 target ${edge.target} 不存在`);
        }
        if (!(edge.weight > 0)) {
            throw new Error(`E_EDGE_WEIGHT: 边 ${edge.id} 的 weight 必须为正数`);
        }
        const key = `${edge.source}->${edge.target}#${edge.type}`;
        const existing = merged.get(key);
        if (existing) {
            existing.weight += edge.weight;
            existing.mergedCount += 1;
        } else {
            merged.set(key, { ...edge, mergedCount: 1 });
        }
    }
    return [...merged.values()];
}

/** 入度/出度统计：用于找枢纽节点（hub）与叶子节点，布局与 LOD 都要消费 */
function computeDegrees(nodes: Map<string, GraphNode>, edges: GraphEdge[]): Map<string, DegreeStat> {
    const stats = new Map<string, DegreeStat>();
    for (const id of nodes.keys()) {
        stats.set(id, { inDegree: 0, outDegree: 0 });
    }
    for (const edge of edges) {
        stats.get(edge.source)!.outDegree += 1;
        stats.get(edge.target)!.inDegree += 1;
    }
    return stats;
}

interface KnowledgeGraph {
    nodes: Map<string, GraphNode>;
    edges: GraphEdge[];
    degrees: Map<string, DegreeStat>;
}

/** 建图唯一入口：任何数据源（接口/本地文件/增量推送）都必须走这里 */
function buildGraph(rawNodes: GraphNode[], rawEdges: GraphEdge[]): KnowledgeGraph {
    const nodes = validateNodes(rawNodes);
    const edges = normalizeEdges(rawEdges, nodes);
    const degrees = computeDegrees(nodes, edges);
    return { nodes, edges, degrees };
}

function runAssertions(): void {
    // ---------- 测试 1：合法数据建图——类型字典通过、默认权重补齐 ----------
    const nodes: GraphNode[] = [
        { id: 'd1', type: 'doc', label: '图谱可视化规范' },
        { id: 'd2', type: 'doc', label: '本体设计指南', weight: 2 },
        { id: 'p1', type: 'person', label: '张三' },
        { id: 't1', type: 'tag', label: '知识管理' },
    ];
    const edges: GraphEdge[] = [
        { id: 'e1', source: 'p1', target: 'd1', type: 'authored', weight: 1 },
        { id: 'e2', source: 'd1', target: 't1', type: 'tagged', weight: 1 },
    ];
    const graph = buildGraph(nodes, edges);
    assert.equal(graph.nodes.size, 4);
    assert.equal(graph.edges.length, 2);
    assert.equal(graph.nodes.get('d1')!.weight, 1, '缺省 weight 应补 1');
    assert.equal(graph.nodes.get('d2')!.weight, 2);
    console.log('[1/4] 建图 OK, 4 节点 / 2 边, 默认权重补齐');

    // ---------- 测试 2：脏数据拦截——重复 id、字典外类型、空 label ----------
    assert.throws(
        () => buildGraph([...nodes, { id: 'd1', type: 'doc', label: '重复' }], []),
        /E_DUP_NODE/,
        '重复节点 id 必须拒绝',
    );
    assert.throws(
        () => buildGraph([{ id: 'x1', type: 'video' as NodeType, label: '视频' }], []),
        /E_NODE_TYPE/,
        '字典外节点类型必须拒绝',
    );
    assert.throws(
        () => buildGraph([{ id: 'x2', type: 'doc', label: '   ' }], []),
        /E_NODE_LABEL/,
        '空 label 必须拒绝',
    );
    console.log('[2/4] 脏数据拦截 OK, 重复 id / 未知类型 / 空 label 均被拒');

    // ---------- 测试 3：悬空边与多重边合并——同 key 边 weight 累加 ----------
    assert.throws(
        () => buildGraph(nodes, [{ id: 'e9', source: 'd1', target: 'ghost', type: 'references', weight: 1 }]),
        /E_DANGLING/,
        '悬空边必须拒绝',
    );
    const multiEdges: GraphEdge[] = [
        { id: 'm1', source: 'd1', target: 'd2', type: 'references', weight: 1 },
        { id: 'm2', source: 'd1', target: 'd2', type: 'references', weight: 2 },
        { id: 'm3', source: 'd1', target: 'd2', type: 'related', weight: 1 },
    ];
    const mergedGraph = buildGraph(nodes, multiEdges);
    assert.equal(mergedGraph.edges.length, 2, '同 source+target+type 应合并');
    const refEdge = mergedGraph.edges.find((e) => e.type === 'references')!;
    assert.equal(refEdge.weight, 3, '多重边 weight 应累加为 3');
    assert.equal((refEdge as GraphEdge & { mergedCount: number }).mergedCount, 2, '应记录合并数 2');
    console.log('[3/4] 悬空边拒绝 + 多重边合并 OK, 3 条原始边归并为 2 条');

    // ---------- 测试 4：入度出度统计——枢纽与叶子识别 ----------
    const star = buildGraph(
        nodes,
        [
            { id: 's1', source: 'p1', target: 'd1', type: 'authored', weight: 1 },
            { id: 's2', source: 'p1', target: 'd2', type: 'authored', weight: 1 },
            { id: 's3', source: 'd1', target: 't1', type: 'tagged', weight: 1 },
            { id: 's4', source: 'd2', target: 't1', type: 'tagged', weight: 1 },
        ],
    );
    assert.deepEqual(star.degrees.get('p1'), { inDegree: 0, outDegree: 2 }, 'p1 出度 2 入度 0');
    assert.deepEqual(star.degrees.get('t1'), { inDegree: 2, outDegree: 0 }, 't1 入度 2 出度 0');
    // 枢纽判定：单方向度 >= 2（集散型节点），d1/d2 一进一出不算枢纽
    const hubs = [...star.degrees.entries()]
        .filter(([, stat]) => Math.max(stat.inDegree, stat.outDegree) >= 2)
        .map(([id]) => id)
        .sort();
    assert.deepEqual(hubs, ['p1', 't1'], '单方向度 >= 2 的枢纽应为 p1 与 t1');
    console.log('[4/4] 度数统计 OK, 枢纽节点 p1/t1 识别正确');

    console.log('\n✅ 125-01 图数据契约与校验 全部断言通过');
}

runAssertions();
