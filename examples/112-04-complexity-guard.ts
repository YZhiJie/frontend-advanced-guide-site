// 文件: examples/112-04-complexity-guard.ts
// 复杂度/深度限流：按字段权重 × 连接分页倍数计算成本，超限/超深/别名放大直接拒绝
// 目标：同一个查询在「客户端预算」与「服务端上限」之间可量化，拒绝原因能定位到字段路径

import assert from 'node:assert';

interface FieldNode {
    name: string;
    alias?: string;
    args?: Record<string, string | number | boolean>;
    selection?: FieldNode[];
}

interface GuardConfig {
    maxCost: number;
    maxDepth: number;
    maxAliases: number;
    weights: Record<string, number>;
    connections: Record<string, boolean>;
    forbidden: string[];
}

type ViolationCode = 'COST' | 'DEPTH' | 'ALIAS' | 'FORBIDDEN';

interface Violation {
    code: ViolationCode;
    path: string;
    message: string;
}

interface GuardReport {
    ok: boolean;
    cost: number;
    maxDepth: number;
    violations: Violation[];
    hotspots: Array<{ path: string; cost: number }>;
}

const config: GuardConfig = {
    maxCost: 1000,
    maxDepth: 4,
    maxAliases: 3,
    weights: { products: 5, product: 2, reviews: 20, relatedProducts: 10, author: 1 },
    connections: { products: true, reviews: true, relatedProducts: true, search: true },
    forbidden: ['__schema', '__type'],
};

/** 连接字段的分页倍数：缺省按 10 条估，钳在 1..50 */
function pageSize(field: FieldNode): number {
    const raw = field.args?.first;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 10;
    return Math.min(50, Math.max(1, Math.floor(raw)));
}

function fieldPath(parent: string, field: FieldNode): string {
    const own = field.alias ?? field.name;
    return parent === '' ? own : `${parent}.${own}`;
}

/** 遍历一层字段，统计同名字段出现次数，识别 alias 放大 */
function checkAliases(fields: FieldNode[], parentPath: string, cfg: GuardConfig, violations: Violation[]): void {
    const counts = new Map<string, number>();
    for (const field of fields) counts.set(field.name, (counts.get(field.name) ?? 0) + 1);
    for (const [name, count] of counts) {
        if (count > cfg.maxAliases) {
            violations.push({
                code: 'ALIAS',
                path: parentPath === '' ? 'query' : parentPath,
                message: `同一层字段 ${name} 出现 ${count} 次（alias 放大），上限 ${cfg.maxAliases}`,
            });
        }
    }
    for (const field of fields) {
        if (field.selection) checkAliases(field.selection, fieldPath(parentPath, field), cfg, violations);
    }
}

interface MeasureContext {
    cfg: GuardConfig;
    violations: Violation[];
    hotspots: Array<{ path: string; cost: number }>;
    maxDepth: number;
}

/**
 * 成本 = 字段权重 + 子选择集成本 × 分页倍数（仅连接字段有倍数）。
 * 连接字段的 first 会被钳到 1..50，避免 first: 99999 把成本算爆或算漏。
 */
function measure(field: FieldNode, depth: number, parentPath: string, ctx: MeasureContext): number {
    const path = fieldPath(parentPath, field);
    const weight = ctx.cfg.weights[field.name] ?? 1;

    if (ctx.cfg.forbidden.includes(field.name)) {
        ctx.violations.push({ code: 'FORBIDDEN', path, message: `禁止查询字段 ${field.name}` });
    }
    if (depth > ctx.cfg.maxDepth) {
        ctx.violations.push({
            code: 'DEPTH',
            path,
            message: `字段 ${path} 深度 ${depth} 超过上限 ${ctx.cfg.maxDepth}`,
        });
    }
    ctx.maxDepth = Math.max(ctx.maxDepth, depth);

    let childCost = 0;
    if (field.selection) {
        for (const child of field.selection) childCost += measure(child, depth + 1, path, ctx);
    }
    const multiplier = ctx.cfg.connections[field.name] ? pageSize(field) : 1;
    const cost = weight + childCost * multiplier;
    ctx.hotspots.push({ path, cost });
    return cost;
}

function guard(fields: FieldNode[], cfg: GuardConfig = config): GuardReport {
    const ctx: MeasureContext = { cfg, violations: [], hotspots: [], maxDepth: 0 };
    checkAliases(fields, '', cfg, ctx.violations);

    let cost = 0;
    for (const field of fields) cost += measure(field, 1, '', ctx);

    if (cost > cfg.maxCost) {
        ctx.violations.push({
            code: 'COST',
            path: 'query',
            message: `查询成本 ${cost} 超过上限 ${cfg.maxCost}`,
        });
    }

    const hotspots = [...ctx.hotspots].sort((a, b) => b.cost - a.cost).slice(0, 5);
    return {
        ok: ctx.violations.length === 0,
        cost,
        maxDepth: ctx.maxDepth,
        violations: ctx.violations,
        hotspots,
    };
}

function runAssertions() {
    // ---------- 测试 1：常规列表查询——成本可精确计算 ----------
    const listQuery: FieldNode[] = [
        {
            name: 'products',
            args: { first: 10 },
            selection: [{ name: 'id' }, { name: 'title' }, { name: 'price' }],
        },
    ];
    const listReport = guard(listQuery);
    assert.equal(listReport.cost, 35, '5 + (1+1+1) × 10 = 35');
    assert.equal(listReport.maxDepth, 2, 'products 为 1 层，叶子为 2 层');
    assert.equal(listReport.ok, true);
    assert.deepEqual(listReport.violations, []);
    assert.equal(listReport.hotspots[0].path, 'products');
    console.log('[1/4] 基础查询成本 OK, cost:', listReport.cost, 'depth:', listReport.maxDepth);

    // ---------- 测试 2：深度超限——嵌套评论/作者/好友被拒绝 ----------
    const deepQuery: FieldNode[] = [
        {
            name: 'products',
            args: { first: 5 },
            selection: [
                {
                    name: 'reviews',
                    args: { first: 3 },
                    selection: [
                        {
                            name: 'author',
                            selection: [{ name: 'profile', selection: [{ name: 'friends', selection: [{ name: 'name' }] }] }],
                        },
                    ],
                },
            ],
        },
    ];
    const deepReport = guard(deepQuery);
    assert.equal(deepReport.cost, 165, '5 + (20 + 4×3)×5 = 165');
    assert.equal(deepReport.maxDepth, 6);
    assert.equal(deepReport.ok, false);
    assert.equal(deepReport.violations.length, 2, 'friends 与 name 两层都越界');
    assert.ok(deepReport.violations.every((violation) => violation.code === 'DEPTH'));
    assert.ok(deepReport.violations.some((violation) => violation.path === 'products.reviews.author.profile.friends'));
    console.log('[2/4] 深度限流 OK, 越界路径:', deepReport.violations.map((violation) => violation.path).join(' | '));

    // ---------- 测试 3：成本超限——嵌套连接被分页倍数放大 ----------
    const expensiveQuery: FieldNode[] = [
        {
            name: 'products',
            args: { first: 100 }, // 钳到 50
            selection: [
                { name: 'id' },
                { name: 'name' },
                {
                    name: 'reviews',
                    args: { first: 20 },
                    selection: [{ name: 'body' }, { name: 'author', selection: [{ name: 'name' }] }],
                },
                {
                    name: 'relatedProducts',
                    args: { first: 20 },
                    selection: [{ name: 'id' }, { name: 'price' }],
                },
            ],
        },
    ];
    const expensiveReport = guard(expensiveQuery);
    assert.equal(expensiveReport.cost, 6605);
    assert.equal(expensiveReport.maxDepth, 4, '深度没有越界，只有成本越界');
    assert.equal(expensiveReport.violations.length, 1);
    assert.equal(expensiveReport.violations[0].code, 'COST');
    assert.equal(expensiveReport.hotspots[0].path, 'products');
    assert.equal(expensiveReport.hotspots[1].path, 'products.reviews', 'reviews 应是第二热点');
    console.log('[3/4] 成本限流 OK, cost:', expensiveReport.cost, '热点:', expensiveReport.hotspots[1].path);

    // ---------- 测试 4：alias 放大 / 内省字段 / 合法边界 ----------
    const aliasQuery: FieldNode[] = ['a', 'b', 'c', 'd'].map((alias) => ({
        name: 'products',
        alias,
        args: { first: 20 },
        selection: [{ name: 'id' }],
    }));
    const aliasReport = guard(aliasQuery);
    assert.equal(aliasReport.ok, false);
    assert.deepEqual(aliasReport.violations.map((violation) => violation.code), ['ALIAS']);
    assert.equal(aliasReport.violations[0].path, 'query');
    assert.equal(aliasReport.cost, 100, '4 × (5 + 20) = 100，成本没超但别名超了');

    const introspectReport = guard([{ name: '__schema', selection: [{ name: 'types', selection: [{ name: 'name' }] }] }]);
    assert.equal(introspectReport.ok, false);
    assert.equal(introspectReport.violations[0].code, 'FORBIDDEN');
    assert.equal(introspectReport.violations[0].path, '__schema');

    const boundaryReport = guard([
        { name: 'products', args: { first: 33 }, selection: [{ name: 'id' }, { name: 'title' }] },
    ]);
    assert.equal(boundaryReport.cost, 71, '5 + 2×33 = 71');
    assert.equal(boundaryReport.ok, true, '边界内的查询应放行');
    console.log('[4/4] alias/内省/边界 OK, 边界 cost:', boundaryReport.cost);

    console.log('\n✅ 112-04 复杂度与深度限流 全部断言通过');
}

runAssertions();
