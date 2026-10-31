// 文件: examples/19-08-permission.ts
// ============ 权限模型:资源:动作 通配匹配 + 按钮级判定 + 路由守卫 ============
// 权限码统一用 '资源:动作' 格式('user:edit'),'*' 为超管,'资源:*' 为该资源全权。
// 判定逻辑只写一份,按钮显隐、路由拦截、接口防误调三处复用。

/** 判断单条需求权限是否被某条持有权限满足 */
export function matchRule(required: string, owned: string): boolean {
    if (owned === '*') return true; // 超管
    if (required === owned) return true; // 精确相等:user:edit === user:edit
    if (owned.endsWith(':*')) {
        // 资源级通配:user:* 满足 user:edit / user:delete
        return required.startsWith(owned.slice(0, -1)); // 截掉 '*',保留 'user:'
    }
    return false;
}

/** 当前用户是否拥有某条权限(持有列表中任意一条满足即可) */
export function hasPermission(required: string, owned: readonly string[]): boolean {
    return owned.some((rule) => matchRule(required, rule));
}

/** 批量过滤:把"动作 -> 是否可见"一次算完,给工具栏按钮组用 */
export function resolveActions<T extends string>(
    actions: readonly T[],
    owned: readonly string[],
): Record<T, boolean> {
    return actions.reduce(
        (acc, action) => {
            acc[action] = hasPermission(action, owned);
            return acc;
        },
        {} as Record<T, boolean>,
    );
}

// ---------------- 路由守卫(框架无关的核心) ----------------

export interface GuardRoute {
    path: string;
    /** 访问该路由所需权限;不写表示登录即可访问 */
    permission?: string;
}

export type GuardResult =
    | { type: 'allow' }
    | { type: 'deny'; reason: 'not-authenticated' | 'forbidden' }
    | { type: 'redirect'; to: string };

export interface GuardOptions {
    isAuthenticated: boolean;
    permissions: readonly string[];
    /** 未登录统一跳登录页,并携带来源地址,登录后跳回 */
    loginPath: string;
    currentPath: string;
}

/**
 * 纯函数守卫:React/Vue/小程序各自的路由钩子里调它,
 * 只根据返回 type 决定下一步,不在里面写任何框架 API。
 */
export function resolveRoute(route: GuardRoute, options: GuardOptions): GuardResult {
    if (!options.isAuthenticated) {
        const from = encodeURIComponent(options.currentPath);
        return { type: 'redirect', to: `${options.loginPath}?redirect=${from}` };
    }
    if (route.permission && !hasPermission(route.permission, options.permissions)) {
        return { type: 'deny', reason: 'forbidden' };
    }
    return { type: 'allow' };
}

// ---------------- 验证 ----------------

// ---- 通配匹配矩阵 ----
console.log(matchRule('user:edit', '*')); // true(超管)
console.log(matchRule('user:edit', 'user:edit')); // true(精确)
console.log(matchRule('user:edit', 'user:*')); // true(资源通配)
console.log(matchRule('user:edit', 'order:*')); // false(资源不同)
console.log(matchRule('user:edit', 'user:view')); // false(动作不同)
// ⚠️ 防越权细节:startsWith 的前缀必须带冒号,避免 'user2:x' 误匹配 'user:*'
console.log(matchRule('user2:edit', 'user:*')); // false

// ---- 运营同学的权限:只读用户 + 订单全权 ----
const opsPermissions = ['user:view', 'order:*'];
console.log(hasPermission('user:view', opsPermissions)); // true
console.log(hasPermission('user:delete', opsPermissions)); // false
console.log(hasPermission('order:refund', opsPermissions)); // true

// ---- 工具栏按钮一次性算完 ----
const actions = ['user:view', 'user:create', 'user:edit', 'user:delete'] as const;
console.log(resolveActions(actions, opsPermissions));
// { 'user:view': true, 'user:create': false, 'user:edit': false, 'user:delete': false }

// ---- 路由守卫三态 ----
const guest = { isAuthenticated: false, permissions: [], loginPath: '/login', currentPath: '/users' };
console.log(resolveRoute({ path: '/users', permission: 'user:view' }, guest));
// { type: 'redirect', to: '/login?redirect=%2Fusers' }

const editor = { isAuthenticated: true, permissions: ['user:view'], loginPath: '/login', currentPath: '/users' };
console.log(resolveRoute({ path: '/home' }, editor)); // { type: 'allow' }(登录即可)
console.log(resolveRoute({ path: '/users', permission: 'user:view' }, editor)); // { type: 'allow' }
console.log(resolveRoute({ path: '/users', permission: 'user:delete' }, editor)); // { type: 'deny', reason: 'forbidden' }
