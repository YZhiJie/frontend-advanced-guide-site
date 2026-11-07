// 文件: examples/114-02-guard-pipeline-cycle.ts
// 守卫编排：全局/路由级守卫顺序、异步守卫、重定向链与循环熔断
// 目标：执行顺序可断言、false/异常中止不触发 afterEach、A↔B 重定向被识别并熔断

import assert from 'node:assert';

type GuardResult = void | boolean | { redirect: string };
type Reason = 'ok' | 'aborted' | 'guard-error' | 'redirect-loop' | 'too-many-redirects';

interface GuardContext {
    from: string;
    to: string;
    redirects: number;
}

type Guard = (ctx: GuardContext) => GuardResult | Promise<GuardResult>;
type SyncHook = (ctx: GuardContext) => void;

interface RouteGuardConfig {
    beforeEnter?: Guard;
    beforeLeave?: Guard;
}

interface RouterOptions {
    routes: Record<string, RouteGuardConfig | undefined>;
    beforeEach?: Guard;
    beforeResolve?: Guard;
    afterEach?: SyncHook;
    resolveAsync?: (to: string) => Promise<void>;
    maxRedirects?: number;
}

interface NavResult {
    ok: boolean;
    to: string;
    redirects: number;
    chain: string[];
    reason: Reason;
    error?: string;
}

const DEFAULT_MAX_REDIRECTS = 5;

/**
 * 导航流水线（与 Vue Router 4 的顺序对齐）：
 * leave（仅离开当前页）→ 全局 beforeEach → 路由 beforeEnter → 异步组件解析
 * → 全局 beforeResolve → 提交 → afterEach。
 * 任一守卫返回 false 中止；返回 { redirect } 则发起一次新导航，并做循环检测。
 */
class GuardRouter {
    readonly log: string[] = [];

    constructor(private readonly options: RouterOptions) {}

    async navigate(to: string, from = ''): Promise<NavResult> {
        const chain: string[] = [to];
        const visited = new Set<string>([to]);
        const maxRedirects = this.options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
        let redirects = 0;
        let current = to;

        const fail = (reason: Reason, error?: string): NavResult => ({
            ok: false,
            to: current,
            redirects,
            chain: [...chain],
            reason,
            error,
        });

        // 返回 null 表示继续；返回 NavResult 表示本次导航终止
        const follow = (target: string): NavResult | null => {
            chain.push(target);
            redirects += 1;
            if (visited.has(target)) return fail('redirect-loop');
            if (redirects > maxRedirects) return fail('too-many-redirects');
            visited.add(target);
            current = target;
            return null;
        };

        while (true) {
            const ctx: GuardContext = { from, to: current, redirects };
            const route = this.options.routes[current];

            const runGuard = async (label: string, guard?: Guard): Promise<GuardResult> => {
                if (guard === undefined) return undefined;
                this.log.push(label);
                return await guard(ctx);
            };

            try {
                let stop = this.handle(await runGuard(`leave:${from}`, from === '' ? undefined : this.options.routes[from]?.beforeLeave), follow, fail);
                if (stop) return stop;
                if (current !== ctx.to) continue;

                stop = this.handle(await runGuard('beforeEach', this.options.beforeEach), follow, fail);
                if (stop) return stop;
                if (current !== ctx.to) continue;

                stop = this.handle(await runGuard(`beforeEnter:${current}`, route?.beforeEnter), follow, fail);
                if (stop) return stop;
                if (current !== ctx.to) continue;

                this.log.push(`resolveAsync:${current}`);
                await this.options.resolveAsync?.(current);

                this.log.push('beforeResolve');
                stop = this.handle(await this.options.beforeResolve?.(ctx), follow, fail);
                if (stop) return stop;
                if (current !== ctx.to) continue;

                this.log.push('afterEach');
                this.options.afterEach?.({ from, to: current, redirects });
                return { ok: true, to: current, redirects, chain: [...chain], reason: 'ok' };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return fail('guard-error', message);
            }
        }
    }

    private handle(
        result: GuardResult,
        follow: (target: string) => NavResult | null,
        fail: (reason: Reason, error?: string) => NavResult,
    ): NavResult | null {
        if (result === false) return fail('aborted');
        if (typeof result === 'object' && result !== null) return follow(result.redirect);
        return null;
    }
}

function makeRouter(overrides: Partial<RouterOptions> = {}): GuardRouter {
    return new GuardRouter({
        routes: {},
        ...overrides,
    });
}

async function runAssertions() {
    // ---------- 测试 1：完整顺序（含异步守卫） ----------
    const router1 = makeRouter({
        routes: {
            '/settings': { beforeLeave: () => true },
            '/admin': {
                beforeEnter: async () => {
                    await Promise.resolve(); // 模拟拉取按钮权限
                    return true;
                },
            },
        },
        beforeEach: () => true,
        beforeResolve: () => true,
        resolveAsync: async () => {
            await Promise.resolve();
        },
        afterEach: () => {},
    });
    const result1 = await router1.navigate('/admin', '/settings');
    assert.equal(result1.ok, true);
    assert.deepEqual(router1.log, ['leave:/settings', 'beforeEach', 'beforeEnter:/admin', 'resolveAsync:/admin', 'beforeResolve', 'afterEach']);
    console.log('[1/4] 守卫顺序 OK:', router1.log.join(' → '));

    // ---------- 测试 2：异步 false 与守卫异常都中止，且不触发 afterEach ----------
    const router2 = makeRouter({
        routes: {
            '/checkout': {
                beforeEnter: async () => {
                    await Promise.resolve();
                    return false; // 异步校验库存失败
                },
            },
        },
        afterEach: () => {},
    });
    const result2 = await router2.navigate('/checkout');
    assert.equal(result2.ok, false);
    assert.equal(result2.reason, 'aborted');
    assert.equal(router2.log.includes('afterEach'), false, '中止导航不得触发 afterEach');

    const router3 = makeRouter({
        beforeEach: () => {
            throw new Error('权限服务超时');
        },
        afterEach: () => {},
    });
    const result3 = await router3.navigate('/orders');
    assert.equal(result3.ok, false);
    assert.equal(result3.reason, 'guard-error');
    assert.equal(result3.error, '权限服务超时');
    assert.equal(router3.log.includes('afterEach'), false);
    console.log('[2/4] 中止与异常 OK:', result2.reason, '/', result3.reason);

    // ---------- 测试 3：重定向链——旧链接 → 商品页 → 本地化详情 ----------
    const router4 = makeRouter({
        routes: {
            '/legacy': {},
            '/product': {
                beforeEnter: () => ({ redirect: '/p/42' }),
            },
        },
        beforeEach: (ctx) => (ctx.to === '/legacy' ? { redirect: '/product' } : true),
        resolveAsync: async () => {},
        afterEach: () => {},
    });
    const result4 = await router4.navigate('/legacy');
    assert.equal(result4.ok, true);
    assert.equal(result4.to, '/p/42');
    assert.equal(result4.redirects, 2);
    assert.deepEqual(result4.chain, ['/legacy', '/product', '/p/42']);
    assert.equal(router4.log.filter((line) => line === 'afterEach').length, 1, '整条链只提交一次');
    assert.equal(router4.log.includes('beforeEnter:/legacy'), false, 'beforeEach 重定向后不应再执行旧目标的 beforeEnter');
    console.log('[3/4] 重定向链 OK:', result4.chain.join(' → '));

    // ---------- 测试 4：循环熔断与最大跳数 ----------
    const router5 = makeRouter({
        routes: {
            '/dashboard': {
                beforeEnter: () => ({ redirect: '/403' }), // 无权限
            },
            '/403': {
                beforeEnter: () => ({ redirect: '/dashboard' }), // 「已登录回首页」——经典死循环
            },
        },
    });
    const result5 = await router5.navigate('/dashboard');
    assert.equal(result5.ok, false);
    assert.equal(result5.reason, 'redirect-loop');
    assert.deepEqual(result5.chain, ['/dashboard', '/403', '/dashboard']);
    assert.equal(result5.redirects, 2);
    assert.equal(router5.log.includes('afterEach'), false);

    const chainRoutes: Record<string, RouteGuardConfig> = {};
    for (const [from, to] of [['/r1', '/r2'], ['/r2', '/r3'], ['/r3', '/r4'], ['/r4', '/r5']]) {
        chainRoutes[from] = { beforeEnter: () => ({ redirect: to }) };
    }
    const router6 = makeRouter({ routes: chainRoutes, maxRedirects: 2 });
    const result6 = await router6.navigate('/r1');
    assert.equal(result6.ok, false);
    assert.equal(result6.reason, 'too-many-redirects');
    assert.equal(result6.redirects, 3);
    console.log('[4/4] 循环熔断 OK:', result5.reason, '/', result6.reason);

    console.log('\n✅ 114-02 守卫编排与循环检测 全部断言通过');
}

runAssertions();
