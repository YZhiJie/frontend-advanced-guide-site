// 文件: examples/113-03-dual-route-table.ts
// 双端路由表：同一业务名的路径映射、可选参数裁剪、旧链接跨端重定向与不支持路由降级
// 目标：业务页面少感知端差异；PC 专属路由在 H5 必须降级而不是 404；旧链接保留参数

import assert from 'node:assert';

type EndKind = 'pc' | 'h5';

interface RouteDef {
    name: string;
    path: string;
    view: string;
}

/** 同一业务名在两端是两条记录：路径、视图都可不同，但 name 是业务唯一键 */
const ROUTES: Record<EndKind, RouteDef[]> = {
    pc: [
        { name: 'home', path: '/', view: 'pc/HomePage' },
        { name: 'product', path: '/product/:id', view: 'pc/ProductPage' },
        { name: 'cart', path: '/cart', view: 'pc/CartPage' },
        { name: 'checkout', path: '/checkout', view: 'pc/CheckoutPage' },
        { name: 'orders', path: '/orders/:id?', view: 'pc/OrdersPage' },
        { name: 'admin-import', path: '/admin/import', view: 'pc/AdminImportPage' },
    ],
    h5: [
        { name: 'home', path: '/', view: 'h5/HomePage' },
        { name: 'product', path: '/p/:id', view: 'h5/ProductPage' },
        { name: 'cart', path: '/bag', view: 'h5/CartPage' },
        { name: 'checkout', path: '/checkout', view: 'h5/CheckoutPage' },
        { name: 'orders', path: '/orders', view: 'h5/OrdersPage' }, // 移动端只保留订单列表
    ],
};

/** PC 专属路由在 H5 的降级目标（业务名，不是路径） */
const FALLBACK: Record<EndKind, Record<string, string>> = {
    pc: {},
    h5: { 'admin-import': 'home' },
};

interface ResolvedRoute {
    end: EndKind;
    name: string;
    path: string;
    view: string;
    degraded: boolean;
    reason?: string;
    droppedParams?: string[];
}

interface RouteMatch {
    name: string;
    params: Record<string, string>;
    redirect?: string;
    degraded?: boolean;
}

/** 填充路径模板：可选参数缺失时整段删除，多余参数记入 dropped 由调用方降级 */
function fillPath(template: string, params: Record<string, string>): { path: string; dropped: string[] } {
    const dropped: string[] = [];
    const path = template.replace(/\/:([A-Za-z]+)(\?)?/g, (_match, key: string, optional?: string) => {
        const value = params[key];
        if (value === undefined) {
            if (!optional) dropped.push(key);
            return '';
        }
        return `/${value}`;
    });
    for (const key of Object.keys(params)) {
        if (!template.includes(`:${key}`)) dropped.push(key);
    }
    return { path: path || '/', dropped };
}

/** 按业务名生成当前端路径；不支持或参数被裁剪时返回降级结果，而不是抛错 */
function buildPath(end: EndKind, name: string, params: Record<string, string> = {}): ResolvedRoute {
    const table = ROUTES[end];
    const route = table.find((r) => r.name === name);
    if (!route) {
        const fallbackName = FALLBACK[end][name] ?? 'home';
        const fallback = table.find((r) => r.name === fallbackName);
        assert.ok(fallback, `降级目标 ${fallbackName} 不存在`);
        return {
            ...buildPath(end, fallbackName, {}),
            degraded: true,
            reason: `${name} 在 ${end} 不支持`,
        };
    }
    const filled = fillPath(route.path, params);
    if (filled.dropped.length > 0) {
        return {
            end,
            name,
            path: filled.path,
            view: route.view,
            degraded: true,
            reason: `参数被裁剪: ${filled.dropped.join(',')}`,
            droppedParams: filled.dropped,
        };
    }
    return { end, name, path: filled.path, view: route.view, degraded: false };
}

/** 模板编译为正则；可选段必须先替换，否则会被必填规则吃掉 */
function compile(template: string): RegExp {
    const pattern = template
        .replace(/\/:([A-Za-z]+)\?/g, '(?:/([^/]+))?')
        .replace(/\/:([A-Za-z]+)/g, '/([^/]+)');
    return new RegExp(`^${pattern}/?$`);
}

function extractKeys(template: string): string[] {
    return [...template.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);
}

function matchTemplate(route: RouteDef, actual: string): Record<string, string> | null {
    const matched = compile(route.path).exec(actual);
    if (!matched) return null;
    const params: Record<string, string> = {};
    extractKeys(route.path).forEach((key, index) => {
        const value = matched[index + 1];
        if (value !== undefined) params[key] = value;
    });
    return params;
}

/**
 * 匹配当前端路由；未命中时用另一端的表识别旧链接，重建为当前端路径。
 * 例：PC 分享出的 /product/7 被 H5 打开 → 重定向 /p/7，参数不丢。
 */
function matchPath(end: EndKind, actual: string): RouteMatch | null {
    for (const route of ROUTES[end]) {
        const params = matchTemplate(route, actual);
        if (params) return { name: route.name, params };
    }
    const other: EndKind = end === 'pc' ? 'h5' : 'pc';
    for (const route of ROUTES[other]) {
        const params = matchTemplate(route, actual);
        if (!params) continue;
        return {
            name: route.name,
            params,
            redirect: buildPath(end, route.name, params).path,
            degraded: true,
        };
    }
    return null;
}

function runAssertions() {
    // ---------- 测试 1：同一业务名，两端路径与视图不同 ----------
    const pcProduct = buildPath('pc', 'product', { id: '42' });
    const h5Product = buildPath('h5', 'product', { id: '42' });
    assert.equal(pcProduct.path, '/product/42');
    assert.equal(h5Product.path, '/p/42');
    assert.equal(pcProduct.view, 'pc/ProductPage');
    assert.equal(h5Product.view, 'h5/ProductPage');
    assert.equal(buildPath('pc', 'cart').path, '/cart');
    assert.equal(buildPath('h5', 'cart').path, '/bag');
    assert.equal(pcProduct.degraded, false);
    console.log('[1/4] 双端路径映射 OK');

    // ---------- 测试 2：可选参数与多余参数裁剪 ----------
    assert.equal(buildPath('pc', 'orders', { id: '88' }).path, '/orders/88');
    assert.equal(buildPath('pc', 'orders').path, '/orders');
    const h5Order = buildPath('h5', 'orders', { id: '88' });
    assert.equal(h5Order.path, '/orders');
    assert.equal(h5Order.degraded, true);
    assert.deepEqual(h5Order.droppedParams, ['id']);
    console.log('[2/4] 可选参数与裁剪 OK:', h5Order.reason);

    // ---------- 测试 3：不支持路由降级，不返回 404 ----------
    const h5Admin = buildPath('h5', 'admin-import');
    assert.equal(h5Admin.path, '/');
    assert.equal(h5Admin.name, 'home');
    assert.equal(h5Admin.degraded, true);
    assert.match(h5Admin.reason ?? '', /不支持/);
    assert.equal(buildPath('pc', 'admin-import').path, '/admin/import');
    const unknown = buildPath('h5', 'wishlist');
    assert.equal(unknown.name, 'home');
    assert.equal(unknown.degraded, true);
    console.log('[3/4] 不支持路由降级 OK');

    // ---------- 测试 4：旧链接跨端重定向，参数保留 ----------
    const legacyH5 = matchPath('h5', '/product/7');
    assert.ok(legacyH5);
    assert.equal(legacyH5.name, 'product');
    assert.deepEqual(legacyH5.params, { id: '7' });
    assert.equal(legacyH5.redirect, '/p/7');
    assert.equal(legacyH5.degraded, true);

    const legacyPc = matchPath('pc', '/bag');
    assert.ok(legacyPc);
    assert.equal(legacyPc.redirect, '/cart');

    assert.deepEqual(matchPath('h5', '/bag'), { name: 'cart', params: {} }, '当前端命中不重定向');
    assert.equal(matchPath('h5', '/nope'), null);
    assert.equal(matchPath('pc', '/admin/import')?.name, 'admin-import');
    console.log('[4/4] 旧链接跨端重定向 OK');

    console.log('\n✅ 113-03 双端路由表 全部断言通过');
}

runAssertions();
