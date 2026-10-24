// 文件: examples/07-04-auth-manager.ts —— 安全的 Token 管理器
// ============ access 在内存 + refresh 在 HttpOnly Cookie 的组合实现 ============

class AuthManager {
    private accessToken: string | null = null;   // 只在内存:XSS 拿不到,刷新页面丢失
    private refreshInflight: Promise<string> | null = null;

    /** 应用启动/页面刷新时,用 HttpOnly Cookie 中的 refresh token 换新 access */
    async bootstrap(): Promise<void> {
        try {
            this.accessToken = await this.refresh(); // refresh token 由浏览器自动携带
        } catch {
            this.accessToken = null;                 // 未登录/登录过期
        }
    }

    /** 刷新:并发调用合并为一次(与 6.4 的 401 处理同款模式) */
    private refresh(): Promise<string> {
        this.refreshInflight ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
            .then((r) => {
                if (!r.ok) throw new Error('unauthorized');
                return r.json() as Promise<{ accessToken: string }>;
            })
            .then(({ accessToken }) => {
                this.accessToken = accessToken;
                return accessToken;
            })
            .finally(() => {
                this.refreshInflight = null;
            });
        return this.refreshInflight;
    }

    get token() {
        return this.accessToken;
    }
    get isAuthenticated() {
        return this.accessToken !== null;
    }
    logout() {
        this.accessToken = null;
        // 服务端同时清除 HttpOnly Cookie 并作废 refresh token
        void fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    }
}

export const auth = new AuthManager();
