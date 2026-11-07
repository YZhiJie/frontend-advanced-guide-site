// 文件: examples/125-04-render-culling.ts
// 大规模渲染：视口裁剪（只渲染可见节点）、LOD 分级（缩放阈值切换标签/聚合）、节点预算门禁
// 目标：渲染层只画「看得见的、画得动的」；一切裁剪决策必须是纯函数，可单测、可回放

import assert from 'node:assert';

interface RenderNode {
    id: string;
    x: number;
    y: number;
    radius: number;
    degree: number; // 度数越大越重要，LOD 聚合时优先保留
    label: string;
}

interface RenderEdge {
    source: string;
    target: string;
}

/** 世界坐标系下的可视区域（相机平移缩放后换算得到） */
interface Viewport {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

type LodLevel = 'full' | 'no-label' | 'aggregate';

/** LOD 决策：按缩放比 zoom（1 = 100%）切换。阈值是产品契约，不是随手调的魔法数 */
function decideLod(zoom: number): LodLevel {
    if (zoom >= 0.8) return 'full';       // 近景：节点 + 标签 + 边
    if (zoom >= 0.3) return 'no-label';   // 中景：节点 + 边，隐藏标签
    return 'aggregate';                   // 远景：按网格聚合为簇
}

/** 视口裁剪：节点包围圆与视口相交才渲染。返回可见节点 id 集合 */
function cullNodes(nodes: RenderNode[], viewport: Viewport): Set<string> {
    const visible = new Set<string>();
    for (const node of nodes) {
        const inX = node.x + node.radius >= viewport.minX && node.x - node.radius <= viewport.maxX;
        const inY = node.y + node.radius >= viewport.minY && node.y - node.radius <= viewport.maxY;
        if (inX && inY) visible.add(node.id);
    }
    return visible;
}

/** 边裁剪：两端都可见才画（半可见边会造成「线通向空白」的误导） */
function cullEdges(edges: RenderEdge[], visibleNodes: Set<string>): RenderEdge[] {
    return edges.filter((edge) => visibleNodes.has(edge.source) && visibleNodes.has(edge.target));
}

interface Cluster {
    id: string;
    x: number;
    y: number;
    count: number;
    memberIds: string[];
}

/** 远景聚合：按 cellSize 网格分桶，簇心 = 成员质心；单节点桶直接返回原节点 */
function aggregate(nodes: RenderNode[], cellSize: number): Cluster[] {
    const buckets = new Map<string, RenderNode[]>();
    for (const node of nodes) {
        const key = `${Math.floor(node.x / cellSize)}:${Math.floor(node.y / cellSize)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(node);
    }
    return [...buckets.entries()].map(([key, members]) => ({
        id: `cluster:${key}`,
        x: members.reduce((sum, m) => sum + m.x, 0) / members.length,
        y: members.reduce((sum, m) => sum + m.y, 0) / members.length,
        count: members.length,
        memberIds: members.map((m) => m.id),
    }));
}

interface BudgetResult {
    allowed: RenderNode[];
    dropped: string[];
    degraded: boolean;
}

/**
 * 节点预算门禁：单帧渲染节点数不得超过 budget。
 * 超限不是随机丢——按 degree 降序保留重要节点，保证枢纽不被裁掉。
 */
function enforceBudget(nodes: RenderNode[], budget: number): BudgetResult {
    if (nodes.length <= budget) {
        return { allowed: nodes, dropped: [], degraded: false };
    }
    const sorted = [...nodes].sort((a, b) => b.degree - a.degree);
    return {
        allowed: sorted.slice(0, budget),
        dropped: sorted.slice(budget).map((n) => n.id),
        degraded: true, // 降级必须可见：UI 提示「已隐藏 N 个低关联节点」
    };
}

/** 一帧渲染计划：裁剪 → LOD → 预算，三步都是纯函数 */
function planFrame(
    nodes: RenderNode[],
    edges: RenderEdge[],
    viewport: Viewport,
    zoom: number,
    budget: number,
): { lod: LodLevel; drawNodes: number; drawEdges: number; clusters?: Cluster[]; degraded: boolean } {
    const visible = cullNodes(nodes, viewport);
    const lod = decideLod(zoom);

    if (lod === 'aggregate') {
        const visibleNodes = nodes.filter((n) => visible.has(n.id));
        const clusters = aggregate(visibleNodes, 200);
        const gated = enforceBudget(
            clusters.map((c) => ({ id: c.id, x: c.x, y: c.y, radius: 20, degree: c.count, label: c.id })),
            budget,
        );
        return { lod, drawNodes: gated.allowed.length, drawEdges: 0, clusters, degraded: gated.degraded };
    }

    const visibleEdges = cullEdges(edges, visible);
    const gated = enforceBudget(nodes.filter((n) => visible.has(n.id)), budget);
    const allowedIds = new Set(gated.allowed.map((n) => n.id));
    const drawEdges = visibleEdges.filter((e) => allowedIds.has(e.source) && allowedIds.has(e.target));
    return { lod, drawNodes: gated.allowed.length, drawEdges: drawEdges.length, degraded: gated.degraded };
}

function runAssertions(): void {
    // 构造 8 节点图：左半 4 个、右半 4 个，e 与 h 是高度数枢纽
    const nodes: RenderNode[] = [
        { id: 'a', x: 0, y: 0, radius: 8, degree: 2, label: 'A' },
        { id: 'b', x: 100, y: 0, radius: 8, degree: 1, label: 'B' },
        { id: 'c', x: 0, y: 100, radius: 8, degree: 1, label: 'C' },
        { id: 'e', x: 50, y: 50, radius: 12, degree: 5, label: 'E-hub' },
        { id: 'f', x: 1000, y: 1000, radius: 8, degree: 1, label: 'F' },
        { id: 'g', x: 1100, y: 1000, radius: 8, degree: 1, label: 'G' },
        { id: 'h', x: 1050, y: 1050, radius: 12, degree: 4, label: 'H-hub' },
        { id: 'i', x: 1000, y: 1100, radius: 8, degree: 1, label: 'I' },
    ];
    const edges: RenderEdge[] = [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'e' },
        { source: 'e', target: 'b' },
        { source: 'f', target: 'h' },
        { source: 'h', target: 'g' },
        { source: 'e', target: 'h' }, // 跨区域长边：两端不同时可见时应被裁
    ];
    const leftViewport: Viewport = { minX: -50, minY: -50, maxX: 200, maxY: 200 };

    // ---------- 测试 1：视口裁剪——只留左半 4 节点，跨区域边被裁 ----------
    const visible = cullNodes(nodes, leftViewport);
    assert.deepEqual([...visible].sort(), ['a', 'b', 'c', 'e'], '左视口只含 a/b/c/e');
    const visibleEdges = cullEdges(edges, visible);
    assert.equal(visibleEdges.length, 3, 'e-h 跨区域边与 f-h/h-g 均不可见');
    assert.ok(!visibleEdges.some((edge) => edge.target === 'h'), 'e-h 半可见边必须裁掉');
    console.log('[1/4] 视口裁剪 OK, 8 节点裁到 4, 跨区域边剔除');

    // ---------- 测试 2：LOD 分级——三档阈值切换，边界值明确归属 ----------
    assert.equal(decideLod(1.0), 'full');
    assert.equal(decideLod(0.8), 'full', '0.8 是 full 的下边界');
    assert.equal(decideLod(0.79), 'no-label');
    assert.equal(decideLod(0.3), 'no-label', '0.3 是 no-label 下边界');
    assert.equal(decideLod(0.29), 'aggregate');
    console.log('[2/4] LOD 分级 OK, 0.8 / 0.3 阈值边界正确');

    // ---------- 测试 3：聚合——右半 4 节点在一个 200 网格内聚成 1 簇，质心正确 ----------
    const rightNodes = nodes.filter((n) => ['f', 'g', 'h', 'i'].includes(n.id));
    const clusters = aggregate(rightNodes, 200);
    assert.equal(clusters.length, 1, 'f/g/h/i 在 1000~1100 区间，应聚成 1 簇');
    assert.equal(clusters[0].count, 4);
    assert.equal(clusters[0].x, (1000 + 1100 + 1050 + 1000) / 4, '簇心为成员质心');
    assert.deepEqual(clusters[0].memberIds.sort(), ['f', 'g', 'h', 'i']);
    const mixed = aggregate(nodes, 200);
    assert.equal(mixed.length, 2, '全图按 200 网格聚成左右 2 簇');
    console.log('[3/4] 聚合 OK, 右半 4 节点聚为 1 簇, 全图 2 簇');

    // ---------- 测试 4：预算门禁——超限时按度数保留枢纽，degraded 可见 ----------
    const frame = planFrame(nodes, edges, leftViewport, 1.0, 3);
    assert.equal(frame.lod, 'full');
    assert.equal(frame.drawNodes, 3, '预算 3 只画 3 个节点');
    assert.ok(frame.degraded, '超限必须标记 degraded');
    const gated = enforceBudget(nodes, 3);
    assert.deepEqual(gated.allowed.map((n) => n.id), ['e', 'h', 'a'], '按度数降序保留 e/h/a');
    assert.equal(gated.dropped.length, 5);
    // 预算内不降级
    const room = planFrame(nodes, edges, leftViewport, 1.0, 10);
    assert.equal(room.drawNodes, 4);
    assert.equal(room.degraded, false);
    // 远景聚合帧：右视口 + zoom 0.2 → aggregate 且无散边
    const farFrame = planFrame(nodes, edges, { minX: 900, minY: 900, maxX: 1200, maxY: 1200 }, 0.2, 10);
    assert.equal(farFrame.lod, 'aggregate');
    assert.equal(farFrame.drawEdges, 0, '聚合态不画簇间细边');
    assert.equal(farFrame.clusters!.length, 1);
    console.log('[4/4] 预算门禁 OK, 枢纽优先保留 + degraded 可见 + 聚合帧无散边');

    console.log('\n✅ 125-04 大规模渲染裁剪与 LOD 全部断言通过');
}

runAssertions();
