// 文件: examples/114-01-permission-routes.ts
// 权限路由生成：后端菜单树 → 前端路由表（权限过滤、去重、排序、兜底 404）
// 目标：越权菜单不进表、重复/冲突菜单只留一条、父子路径拼接正确、兜底恒在末尾

import assert from 'node:assert';

type PermissionCode = string;

interface MenuNode {
    id: string;
    title: string;
    path: string;
    name?: string;
    component?: string;
    permission?: PermissionCode;
    sort?: number;
    hidden?: boolean;
    children?: MenuNode[];
}

interface RouteMeta {
    title: string;
    permission?: PermissionCode;
    hidden: boolean;
    sort: number;
    menuId: string;
}

interface RouteRecord {
    path: string;
    name: string;
    component: string;
    meta: RouteMeta;
    children?: RouteRecord[];
}

interface DroppedMenu {
    menuId: string;
    path: string;
    reason: string;
}

interface BuildResult {
    routes: RouteRecord[];
    dropped: DroppedMenu[];
}

/** 静态路由先注册；后端菜单与它们同路径/同名时一律丢弃，避免覆盖登录页 */
const STATIC_ROUTES: Array<{ path: string; name: string }> = [
    { path: '/login', name: 'login' },
    { path: '/', name: 'home' },
];

const NOT_FOUND: RouteRecord = {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: 'NotFoundPage',
    meta: { title: '页面不存在', hidden: true, sort: Number.MAX_SAFE_INTEGER, menuId: 'builtin-404' },
};

function normalizePath(path: string): string {
    const normalized = `/${path}`.replace(/\/+/g, '/');
    return normalized.length > 1 ? normalized.replace(/\/$/, '') : '/';
}

function joinPath(parent: string, path: string): string {
    if (path.startsWith('/')) return normalizePath(path);
    const base = parent === '/' ? '' : parent;
    return normalizePath(`${base}/${path}`);
}

function fallbackName(path: string): string {
    const joined = path
        .replace(/^\/|\/$/g, '')
        .split('/')
        .filter((seg) => seg !== '' && !seg.startsWith(':'))
        .join('-');
    return joined === '' ? 'root' : joined;
}

/**
 * 菜单树 → 路由表。
 * 关键顺序：先按 sort 排序，再做权限剪枝，最后做路径/命名去重——
 * 这样「重复且无权限」的脏数据只会产出一条「缺少权限」，报告更干净。
 */
function buildRoutes(menus: MenuNode[], granted: Set<PermissionCode>): BuildResult {
    const dropped: DroppedMenu[] = [];
    const usedPaths = new Set(STATIC_ROUTES.map((r) => normalizePath(r.path)));
    const usedNames = new Set(STATIC_ROUTES.map((r) => r.name));
    let seq = 0;

    const sortNodes = (nodes: MenuNode[]): MenuNode[] =>
        [...nodes].sort((a, b) => {
            const diff = (a.sort ?? 100) - (b.sort ?? 100);
            if (diff !== 0) return diff;
            return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
        });

    const buildLevel = (nodes: MenuNode[], parentPath: string): RouteRecord[] => {
        const records: RouteRecord[] = [];
        for (const node of sortNodes(nodes)) {
            const path = joinPath(parentPath, node.path);
            if (node.permission !== undefined && !granted.has(node.permission)) {
                dropped.push({ menuId: node.id, path, reason: '缺少权限' });
                continue; // 整棵子树剪掉：目录无权时子菜单单独授权没有意义
            }
            const name = node.name ?? fallbackName(path);
            if (usedPaths.has(path)) {
                dropped.push({ menuId: node.id, path, reason: '路径重复' });
                continue;
            }
            if (usedNames.has(name)) {
                dropped.push({ menuId: node.id, path, reason: '路由重名' });
                continue;
            }
            const hasChildren = node.children !== undefined && node.children.length > 0;
            if (!hasChildren && node.component === undefined) {
                dropped.push({ menuId: node.id, path, reason: '叶子菜单缺少组件' });
                continue;
            }
            usedPaths.add(path);
            usedNames.add(name);
            const record: RouteRecord = {
                path,
                name,
                component: node.component ?? 'Layout',
                meta: {
                    title: node.title,
                    permission: node.permission,
                    hidden: node.hidden ?? false,
                    sort: node.sort ?? seq,
                    menuId: node.id,
                },
            };
            if (hasChildren) record.children = buildLevel(node.children as MenuNode[], path);
            records.push(record);
            seq += 1;
        }
        return records;
    };

    const routes = buildLevel(menus, '/');
    // 兜底必须最后 push：前端兜底优先于后端配置，杜绝「后端漏配 → 白屏」
    routes.push({ ...NOT_FOUND, meta: { ...NOT_FOUND.meta } });
    return { routes, dropped };
}

function flatten(routes: RouteRecord[]): RouteRecord[] {
    return routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);
}

/** 海外电商 B 端后台菜单：财务模块未授权，另有重复路径、重名、与登录页冲突三类脏数据 */
const MENUS: MenuNode[] = [
    { id: 'm-campaign', title: '营销活动', path: '/campaigns', name: 'Campaigns', component: 'CampaignPage', permission: 'campaign:view', sort: 1 },
    { id: 'm-dashboard', title: '工作台', path: '/dashboard', name: 'Dashboard', component: 'DashboardPage', permission: 'dashboard:view', sort: 2 },
    {
        id: 'm-finance',
        title: '财务结算',
        path: '/finance',
        permission: 'finance:view',
        sort: 3,
        children: [{ id: 'm-payout', title: '打款记录', path: 'payout', name: 'PayoutList', component: 'PayoutPage', permission: 'finance:payout' }],
    },
    {
        id: 'm-orders',
        title: '订单管理',
        path: '/orders',
        name: 'Orders',
        sort: 4,
        children: [
            { id: 'm-order-list', title: '订单列表', path: 'list', name: 'OrderList', component: 'OrderListPage', permission: 'order:list', sort: 1 },
            { id: 'm-order-list-dup', title: '订单列表（旧）', path: 'list', name: 'OrderListLegacy', component: 'OrderListPage', sort: 2 },
            { id: 'm-order-detail', title: '订单详情', path: ':orderId', name: 'OrderDetail', component: 'OrderDetailPage', permission: 'order:detail', hidden: true, sort: 3 },
        ],
    },
    { id: 'm-users', title: '用户权限', path: '/users', name: 'Users', component: 'UsersPage', permission: 'user:manage', sort: 5 },
    { id: 'm-login', title: '登录（脏数据）', path: '/login', name: 'LoginDup', component: 'LoginPage', sort: 6 },
    { id: 'm-dup-name', title: '重复命名', path: '/campaign-old', name: 'Campaigns', component: 'CampaignPage', sort: 7 },
];

const GRANTED = new Set<PermissionCode>(['campaign:view', 'dashboard:view', 'order:list', 'order:detail', 'user:manage']);

function runAssertions() {
    const result = buildRoutes(MENUS, GRANTED);
    const flat = flatten(result.routes);

    // ---------- 测试 1：权限剪枝——未授权目录整棵消失 ----------
    const names = flat.map((route) => route.name);
    assert.deepEqual(names, ['Campaigns', 'Dashboard', 'Orders', 'OrderList', 'OrderDetail', 'Users', 'not-found']);
    assert.equal(names.includes('PayoutList'), false, '财务子菜单不应进表');
    assert.equal(flat.some((route) => route.path.startsWith('/finance')), false, '未授权目录整棵剪掉');
    assert.equal(flat.some((route) => route.name === 'OrderListLegacy'), false, '重复列表页不应进表');
    console.log('[1/4] 权限剪枝 OK, 路由数:', flat.length);

    // ---------- 测试 2：去重与冲突报告 ----------
    assert.deepEqual(
        result.dropped.map((item) => item.reason),
        ['缺少权限', '路径重复', '路径重复', '路由重名'],
        '脏数据必须留下可审计的丢弃原因',
    );
    assert.deepEqual(result.dropped.map((item) => item.menuId), ['m-finance', 'm-order-list-dup', 'm-login', 'm-dup-name']);
    assert.equal(result.dropped.some((item) => item.menuId === 'm-login' && item.reason === '路径重复'), true, '静态 /login 不可被后端覆盖');
    console.log('[2/4] 去重与冲突报告 OK:', result.dropped.map((item) => item.reason).join(' / '));

    // ---------- 测试 3：排序与父子路径拼接 ----------
    assert.deepEqual(result.routes.map((route) => route.name), ['Campaigns', 'Dashboard', 'Orders', 'Users', 'not-found']);
    const orders = result.routes.find((route) => route.name === 'Orders');
    assert.ok(orders);
    assert.equal(orders.path, '/orders');
    assert.equal(orders.component, 'Layout', '目录节点由前端补 Layout');
    assert.deepEqual(orders.children?.map((route) => route.path), ['/orders/list', '/orders/:orderId']);
    const detail = orders.children?.find((route) => route.name === 'OrderDetail');
    assert.ok(detail);
    assert.equal(detail.meta.hidden, true);
    assert.equal(detail.meta.permission, 'order:detail');
    console.log('[3/4] 排序与路径拼接 OK, 子路由:', orders.children?.map((route) => route.path).join(' | '));

    // ---------- 测试 4：兜底恒在末尾且表内唯一 ----------
    const last = result.routes[result.routes.length - 1];
    assert.equal(last.name, 'not-found');
    assert.equal(last.path, '/:pathMatch(.*)*');
    assert.equal(last.meta.menuId, 'builtin-404');
    const allNames = new Set(flat.map((route) => route.name));
    const allPaths = new Set(flat.map((route) => route.path));
    assert.equal(allNames.size, flat.length, '路由 name 必须唯一');
    assert.equal(allPaths.size, flat.length, '归一化后 path 必须唯一');
    assert.equal(result.routes.filter((route) => route.name === 'not-found').length, 1);
    console.log('[4/4] 兜底与唯一性 OK, 兜底末位:', last.path);

    console.log('\n✅ 114-01 权限路由生成 全部断言通过');
}

runAssertions();
