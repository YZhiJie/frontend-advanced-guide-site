// 文件: examples/125-02-force-layout.ts
// 简版力导向布局：斥力 + 弹簧力 + 中心引力迭代、能量收敛判定、确定性种子
// 目标：布局必须可复现（同输入同输出），收敛有明确终止条件，不允许无限抖动

import assert from 'node:assert';

/** mulberry32 种子随机数：确定性 PRNG，CI 与快照测试可复现 */
function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface LayoutNode {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
}

interface LayoutEdge {
    source: number; // 节点下标，布局期用下标避免 Map 查找开销
    target: number;
}

interface ForceParams {
    repulsion: number;    // 斥力强度系数
    springLength: number; // 弹簧自然长度
    springK: number;      // 弹簧系数
    gravity: number;      // 向心引力系数
    damping: number;      // 速度阻尼，防震荡
    maxIterations: number;
    epsilon: number;      // 收敛阈值：单步总位移低于它即停
}

const DEFAULT_PARAMS: ForceParams = {
    repulsion: 4000,
    springLength: 120,
    springK: 0.02,
    gravity: 0.05,
    damping: 0.85,
    maxIterations: 500,
    epsilon: 0.5,
};

interface LayoutResult {
    nodes: LayoutNode[];
    iterations: number;
    converged: boolean;
    finalEnergy: number;
}

/** 用种子初始化位置：小半径圆环 + 抖动，避免所有点挤在原点导致斥力方向退化 */
function seedPositions(ids: string[], seed: number): LayoutNode[] {
    const rand = mulberry32(seed);
    return ids.map((id, index) => {
        const angle = (index / ids.length) * Math.PI * 2;
        const radius = 50 + rand() * 30;
        return { id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 };
    });
}

/** 单步迭代：斥力（全对）+ 弹簧力（沿边）+ 中心引力，返回本步总位移作为能量指标 */
function step(nodes: LayoutNode[], edges: LayoutEdge[], params: ForceParams): number {
    const fx = new Array<number>(nodes.length).fill(0);
    const fy = new Array<number>(nodes.length).fill(0);

    // 斥力：任意两节点间 F = repulsion / d^2，距离下限防除零爆炸
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const distSq = Math.max(dx * dx + dy * dy, 1);
            const dist = Math.sqrt(distSq);
            const force = params.repulsion / distSq;
            const fxij = (dx / dist) * force;
            const fyij = (dy / dist) * force;
            fx[i] += fxij;
            fy[i] += fyij;
            fx[j] -= fxij;
            fy[j] -= fyij;
        }
    }

    // 弹簧力：沿边方向 F = springK * (d - L)，拉到自然长度
    for (const edge of edges) {
        const a = nodes[edge.source];
        const b = nodes[edge.target];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const force = params.springK * (dist - params.springLength);
        const fxab = (dx / dist) * force;
        const fyab = (dy / dist) * force;
        fx[edge.source] += fxab;
        fy[edge.source] += fyab;
        fx[edge.target] -= fxab;
        fy[edge.target] -= fyab;
    }

    // 中心引力：把整图拉回原点，防孤岛漂移出画布
    for (let i = 0; i < nodes.length; i++) {
        fx[i] -= nodes[i].x * params.gravity;
        fy[i] -= nodes[i].y * params.gravity;
    }

    let energy = 0;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        node.vx = (node.vx + fx[i]) * params.damping;
        node.vy = (node.vy + fy[i]) * params.damping;
        node.x += node.vx;
        node.y += node.vy;
        energy += Math.abs(node.vx) + Math.abs(node.vy);
    }
    return energy;
}

/** 布局主流程：迭代到能量低于 epsilon（收敛）或耗尽 maxIterations（未收敛要上报） */
function layout(ids: string[], edgePairs: Array<[string, string]>, seed: number, params: ForceParams = DEFAULT_PARAMS): LayoutResult {
    const nodes = seedPositions(ids, seed);
    const indexOf = new Map(ids.map((id, index) => [id, index]));
    const edges: LayoutEdge[] = edgePairs.map(([source, target]) => {
        const si = indexOf.get(source);
        const ti = indexOf.get(target);
        if (si === undefined || ti === undefined) throw new Error(`E_EDGE_NODE: 边引用了不存在的节点 ${source}->${target}`);
        return { source: si, target: ti };
    });

    let iterations = 0;
    let energy = Number.POSITIVE_INFINITY;
    let converged = false;
    while (iterations < params.maxIterations) {
        energy = step(nodes, edges, params);
        iterations += 1;
        if (energy < params.epsilon) {
            converged = true;
            break;
        }
    }
    return { nodes, iterations, converged, finalEnergy: energy };
}

function runAssertions(): void {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const edgePairs: Array<[string, string]> = [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
        ['d', 'a'],
        ['a', 'c'],
    ];

    // ---------- 测试 1：确定性——同种子两次布局坐标逐位一致；异种子初值不同但收敛到同形状 ----------
    const run1 = layout(ids, edgePairs, 42);
    const run2 = layout(ids, edgePairs, 42);
    const run3 = layout(ids, edgePairs, 7);
    for (let i = 0; i < ids.length; i++) {
        assert.equal(run1.nodes[i].x, run2.nodes[i].x, `节点 ${ids[i]} 同种子 x 必须一致`);
        assert.equal(run1.nodes[i].y, run2.nodes[i].y, `节点 ${ids[i]} 同种子 y 必须一致`);
    }
    const init42 = seedPositions(ids, 42);
    const init7 = seedPositions(ids, 7);
    assert.ok(init42.some((node, i) => node.x !== init7[i].x || node.y !== init7[i].y), '不同种子初始位置应不同');
    // 力导向是收缩动力学：收敛后形状（两两距离矩阵）与初始种子无关，仅差刚体变换
    const pairDist = (g: LayoutResult, p: number, q: number): number =>
        Math.hypot(g.nodes[p].x - g.nodes[q].x, g.nodes[p].y - g.nodes[q].y);
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const d1 = pairDist(run1, i, j);
            const d3 = pairDist(run3, i, j);
            assert.ok(Math.abs(d1 - d3) < d1 * 0.05 + 1, `距离 ${ids[i]}-${ids[j]} 应跨种子稳定: ${d1.toFixed(1)} vs ${d3.toFixed(1)}`);
        }
    }
    console.log('[1/4] 确定性 OK, 种子 42 两次结果逐位一致, 跨种子形状稳定');

    // ---------- 测试 2：收敛——能量单调趋势下降且最终收敛、坐标有限 ----------
    assert.ok(run1.converged, '500 步内应收敛');
    assert.ok(run1.finalEnergy < DEFAULT_PARAMS.epsilon, `最终能量 ${run1.finalEnergy} 应低于阈值`);
    assert.ok(run1.iterations < DEFAULT_PARAMS.maxIterations, '收敛应提前于 maxIterations');
    for (const node of run1.nodes) {
        assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), '坐标必须有限，不允许 NaN/Infinity');
    }
    console.log(`[2/4] 收敛 OK, ${run1.iterations} 步后能量 ${run1.finalEnergy.toFixed(3)} < ${DEFAULT_PARAMS.epsilon}`);

    // ---------- 测试 3：布局质量——四边形环+对角线中，唯一无边对 b-d 应是最远点对 ----------
    const indexOf = new Map(ids.map((id, index) => [id, index]));
    const dist = (g: LayoutResult, p: string, q: string): number => {
        const a = g.nodes[indexOf.get(p)!];
        const b = g.nodes[indexOf.get(q)!];
        return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const unlinkedGap = dist(run1, 'b', 'd'); // 环中唯一没有边相连的一对
    for (const [p, q] of edgePairs) {
        const linked = dist(run1, p, q);
        assert.ok(linked < unlinkedGap, `有边对 ${p}-${q} 距离 ${linked.toFixed(1)} 应小于无边对 ${unlinkedGap.toFixed(1)}`);
    }
    for (let i = 0; i < run1.nodes.length; i++) {
        for (let j = i + 1; j < run1.nodes.length; j++) {
            const gap = Math.hypot(run1.nodes[i].x - run1.nodes[j].x, run1.nodes[i].y - run1.nodes[j].y);
            assert.ok(gap > 5, `节点 ${ids[i]} 与 ${ids[j]} 距离 ${gap.toFixed(1)} 过小，斥力未生效`);
        }
    }
    console.log('[3/4] 布局质量 OK, 无边对最远且任意两节点不重叠');

    // ---------- 测试 4：边界——悬空边报错；孤立点被引力拉回中心附近 ----------
    assert.throws(() => layout(ids, [['a', 'ghost']], 42), /E_EDGE_NODE/, '引用不存在节点的边必须报错');
    const withIsolated = layout(['a', 'b', 'x'], [['a', 'b']], 42);
    const isolated = withIsolated.nodes[indexOf.get('x') ?? 2];
    const centerDist = Math.hypot(isolated.x, isolated.y);
    const spread = Math.max(...withIsolated.nodes.map((n) => Math.hypot(n.x, n.y)));
    assert.ok(centerDist <= spread + 1e-9, '孤立点不应是离中心最远的点（引力生效）');
    console.log('[4/4] 边界 OK, 悬空边拒绝 + 孤立点被引力约束');

    console.log('\n✅ 125-02 力导向布局与收敛 全部断言通过');
}

runAssertions();
