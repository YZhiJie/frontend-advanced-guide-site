// 文件: examples/125-03-subgraph-query.ts
// 子图与路径：k-hop 邻域提取、两点间最短路径（BFS）、证据链高亮路径集、环的处理
// 目标：钻取交互的查询内核——邻域有界、路径最短、环不死循环、证据链可解释

import assert from 'node:assert';

interface AdjEdge {
    to: string;
    type: string;
}

type Adjacency = Map<string, AdjEdge[]>;

/** 由边表构建邻接表；directed=false 时双向展开（钻取常按无向处理） */
function buildAdjacency(edges: Array<{ source: string; target: string; type: string }>, directed = false): Adjacency {
    const adj: Adjacency = new Map();
    const push = (from: string, to: string, type: string): void => {
        if (!adj.has(from)) adj.set(from, []);
        adj.get(from)!.push({ to, type });
    };
    for (const edge of edges) {
        push(edge.source, edge.target, edge.type);
        if (!directed) push(edge.target, edge.source, edge.type);
    }
    return adj;
}

interface Subgraph {
    nodes: Set<string>;
    edges: Array<{ source: string; target: string; type: string }>;
    /** 每个节点距起点的层数，前端用它做圈层透明度渐变 */
    depthOf: Map<string, number>;
}

/**
 * k-hop 邻域提取（BFS 按层扩展）。
 * 环的处理：visited 集合保证每节点只入队一次，环上节点取最短层数，不会死循环。
 * budget 是硬门禁：邻居数超预算按 BFS 顺序截断，防止枢纽节点（一度几千边）拖垮渲染。
 */
function kHop(adj: Adjacency, start: string, k: number, budget = Number.POSITIVE_INFINITY): Subgraph {
    if (!adj.has(start)) throw new Error(`E_START_NODE: 起点 ${start} 不存在`);
    if (k < 0) throw new Error('E_K: k 必须 >= 0');

    const nodes = new Set<string>([start]);
    const depthOf = new Map<string, number>([[start, 0]]);
    const subEdges: Array<{ source: string; target: string; type: string }> = [];
    let frontier = [start];

    for (let depth = 1; depth <= k; depth++) {
        const next: string[] = [];
        for (const current of frontier) {
            for (const edge of adj.get(current) ?? []) {
                subEdges.push({ source: current, target: edge.to, type: edge.type });
                if (nodes.size >= budget) break;
                if (!nodes.has(edge.to)) {
                    nodes.add(edge.to);
                    depthOf.set(edge.to, depth);
                    next.push(edge.to);
                }
            }
            if (nodes.size >= budget) break;
        }
        frontier = next;
        if (frontier.length === 0 || nodes.size >= budget) break;
    }
    return { nodes, edges: subEdges, depthOf };
}

/**
 * 两点间最短路径（BFS 父亲指针回溯）。
 * 返回节点 id 序列；不可达返回 null（前端要给出「无关联路径」提示，而非空白）。
 */
function shortestPath(adj: Adjacency, from: string, to: string): string[] | null {
    if (from === to) return [from];
    const visited = new Set<string>([from]);
    const parent = new Map<string, string>();
    let frontier = [from];

    while (frontier.length > 0) {
        const next: string[] = [];
        for (const current of frontier) {
            for (const edge of adj.get(current) ?? []) {
                if (visited.has(edge.to)) continue; // 环防护：已访问不再入队
                visited.add(edge.to);
                parent.set(edge.to, current);
                if (edge.to === to) {
                    const path = [to];
                    let cursor = to;
                    while (cursor !== from) {
                        cursor = parent.get(cursor)!;
                        path.unshift(cursor);
                    }
                    return path;
                }
                next.push(edge.to);
            }
        }
        frontier = next;
    }
    return null;
}

/**
 * 证据链高亮：RAG 答案引用了若干证据节点，高亮集合 = 各证据到主题节点最短路径的并集。
 * 返回需高亮的节点与边，渲染层据此设置高亮样式，其余降透明度。
 */
function evidenceHighlight(
    adj: Adjacency,
    topic: string,
    evidenceIds: string[],
): { highlightNodes: Set<string>; highlightEdges: Set<string>; unreachable: string[] } {
    const highlightNodes = new Set<string>();
    const highlightEdges = new Set<string>();
    const unreachable: string[] = [];

    for (const evidence of evidenceIds) {
        const path = shortestPath(adj, topic, evidence);
        if (!path) {
            unreachable.push(evidence);
            continue;
        }
        for (const id of path) highlightNodes.add(id);
        for (let i = 0; i + 1 < path.length; i++) {
            // 无向 key：双向一致，避免 A-B 与 B-A 被判成两条边
            highlightEdges.add([path[i], path[i + 1]].sort().join('->'));
        }
    }
    return { highlightNodes, highlightEdges, unreachable };
}

function runAssertions(): void {
    // 知识图谱切片：主题 hub 为中心，含一个环 b-c-d-b 与孤立证据 g
    const edgeList = [
        { source: 'hub', target: 'a', type: 'references' },
        { source: 'hub', target: 'b', type: 'references' },
        { source: 'a', target: 'c', type: 'references' },
        { source: 'b', target: 'c', type: 'references' },
        { source: 'c', target: 'd', type: 'references' },
        { source: 'd', target: 'b', type: 'references' }, // 环：b-c-d-b
        { source: 'd', target: 'e', type: 'related' },
        { source: 'f', target: 'g', type: 'related' }, // 独立连通分量
    ];
    const adj = buildAdjacency(edgeList);

    // ---------- 测试 1：k-hop 邻域——层数精确、环不重复、k=0 只含起点 ----------
    const hop1 = kHop(adj, 'hub', 1);
    assert.deepEqual([...hop1.nodes].sort(), ['a', 'b', 'hub'], '1-hop 只含直接邻居');
    assert.equal(hop1.depthOf.get('hub'), 0);
    assert.equal(hop1.depthOf.get('a'), 1);

    const hop2 = kHop(adj, 'hub', 2);
    assert.deepEqual([...hop2.nodes].sort(), ['a', 'b', 'c', 'd', 'hub'], '2-hop 到 c 与 d（d 经 b 直连）');
    assert.equal(hop2.depthOf.get('c'), 2, 'c 经 a 或 b 到达，层数取最短 2');
    assert.equal(hop2.depthOf.get('d'), 2, 'd 经 b 直连，层数 2 而非 3');

    const hop3 = kHop(adj, 'hub', 3);
    assert.ok(hop3.nodes.has('e'), '3-hop 到 e');
    assert.equal(hop3.depthOf.get('e'), 3, 'e 经 b-d 到达，层数 3');
    assert.ok(!hop3.nodes.has('f'), '不同连通分量不可达');

    const hop0 = kHop(adj, 'hub', 0);
    assert.deepEqual([...hop0.nodes], ['hub'], 'k=0 只含起点');
    console.log('[1/4] k-hop 邻域 OK, 1/2/3 层扩展精确, 环无重复');

    // ---------- 测试 2：预算截断——枢纽邻居超 budget 时按 BFS 序截断 ----------
    const starEdges = Array.from({ length: 10 }, (_, i) => ({ source: 'hub', target: `n${i}`, type: 'related' }));
    const starAdj = buildAdjacency(starEdges);
    const limited = kHop(starAdj, 'hub', 1, 4);
    assert.equal(limited.nodes.size, 4, '预算 4 应截断为起点 + 3 邻居');
    assert.deepEqual([...limited.nodes].sort(), ['hub', 'n0', 'n1', 'n2'], '按边表顺序截断');
    assert.throws(() => kHop(adj, 'ghost', 1), /E_START_NODE/, '不存在起点必须报错');
    console.log('[2/4] 预算门禁 OK, 10 邻居截断为 4, 非法起点报错');

    // ---------- 测试 3：最短路径——跨环取最短、不可达返回 null、自环长度 0 ----------
    const path = shortestPath(adj, 'hub', 'e');
    assert.deepEqual(path, ['hub', 'b', 'd', 'e'], 'hub->e 最短 3 步（不经 c）');
    assert.equal(shortestPath(adj, 'hub', 'hub')!.length, 1, '到自身路径长度为 1');
    assert.equal(shortestPath(adj, 'hub', 'g'), null, '跨连通分量返回 null');
    const pathToD = shortestPath(adj, 'a', 'd');
    assert.deepEqual(pathToD, ['a', 'c', 'd'], 'a->d 走 a-c-d 两步');
    console.log('[3/4] 最短路径 OK, 环上取最短 + 不可达返回 null');

    // ---------- 测试 4：证据链高亮——多证据路径并集、不可达单独上报 ----------
    // hub->e 最短路径 hub-b-d-e；hub->c 最短路径 hub-a-c（BFS 先访问 a）
    const { highlightNodes, highlightEdges, unreachable } = evidenceHighlight(adj, 'hub', ['e', 'c', 'g']);
    assert.ok(highlightNodes.has('hub') && highlightNodes.has('b') && highlightNodes.has('d') && highlightNodes.has('e'));
    assert.ok(highlightNodes.has('a') && highlightNodes.has('c'), 'c 的路径经 a，a 也在高亮集内');
    assert.deepEqual(unreachable, ['g'], 'g 不可达应单独列出');
    assert.ok(highlightEdges.has('b->hub') && highlightEdges.has('b->d') && highlightEdges.has('d->e'), 'hub-b-d-e 全段高亮');
    assert.ok(highlightEdges.has('a->hub') && highlightEdges.has('a->c'), 'hub-a-c 全段高亮');
    assert.ok(!highlightEdges.has('c->d'), 'c-d 不在任何最短路径上，不得高亮');
    assert.equal(highlightEdges.size, 5, '两条路径共 5 条边（无共享前缀）');
    console.log('[4/4] 证据链高亮 OK, 路径并集 + 不可达上报');

    console.log('\n✅ 125-03 子图查询与证据链 全部断言通过');
}

runAssertions();
