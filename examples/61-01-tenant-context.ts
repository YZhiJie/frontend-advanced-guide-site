/** 61-01-tenant-context.ts —— 租户解析（子域名/路径/Header 优先级）+ 请求注入 + 缓存键隔离 */

type TenantSource = "subdomain" | "path" | "header" | "query" | "default";
interface TenantCtx {
  tenantId: string;
  source: TenantSource;
}

// 解析优先级：子域名 > 路径前缀 > 显式 Header > query > 默认租户
// 多来源同时存在时取最高优先级,绝不"混用"(子域名是 A、路径是 B → 按 A,但必须告警)
function resolveTenant(input: {
  host?: string;
  pathname?: string;
  headerTenant?: string;
  queryTenant?: string;
  rootDomains?: string[];
}): TenantCtx {
  const rootDomains = input.rootDomains ?? ["saas-app.com"];
  const host = input.host ?? "";
  // 1) 子域名：acme.saas-app.com → acme（www/api/app 等保留子域不算租户）
  const RESERVED = new Set(["www", "api", "app", "admin", "cdn"]);
  for (const root of rootDomains) {
    if (host.endsWith(`.${root}`)) {
      const sub = host.slice(0, host.length - root.length - 1);
      if (sub && !sub.includes(".") && !RESERVED.has(sub)) {
        return { tenantId: sub, source: "subdomain" };
      }
    }
  }
  // 2) 路径前缀：/t/acme/dashboard → acme
  const m = (input.pathname ?? "").match(/^\/t\/([\w-]+)(\/|$)/);
  if (m) return { tenantId: m[1], source: "path" };
  // 3) 显式 Header（API 调用、服务端转发场景）
  if (input.headerTenant) return { tenantId: input.headerTenant, source: "header" };
  // 4) query（分享链接兜底，最容易被伪造,优先级最低）
  if (input.queryTenant) return { tenantId: input.queryTenant, source: "query" };
  return { tenantId: "default", source: "default" };
}

// 请求注入：所有出站请求统一带 X-Tenant-Id,杜绝"有的请求带了有的没带"
interface Req {
  url: string;
  headers: Record<string, string>;
}
function injectTenant(req: Req, ctx: TenantCtx): Req {
  // 防御：调用方已手动塞了别的租户头,说明代码有绕过拦截器的私货,直接拒绝
  const existing = req.headers["X-Tenant-Id"];
  if (existing && existing !== ctx.tenantId) {
    throw new Error(`租户冲突: 请求头=${existing} vs 上下文=${ctx.tenantId}`);
  }
  return { ...req, headers: { ...req.headers, "X-Tenant-Id": ctx.tenantId } };
}

// 缓存键隔离：本地缓存/请求缓存/状态缓存一律拼 tenantId,切租户天然不串
function tenantCacheKey(ctx: TenantCtx, biz: string, key: string): string {
  return `${ctx.tenantId}::${biz}::${key}`;
}

// 简易租户命名空间 LocalStorage（真实项目用包装层,这里验证键设计）
class TenantStorage {
  private store = new Map<string, string>();
  constructor(private getCtx: () => TenantCtx) {}
  set(biz: string, key: string, value: string) {
    this.store.set(tenantCacheKey(this.getCtx(), biz, key), value);
  }
  get(biz: string, key: string): string | undefined {
    return this.store.get(tenantCacheKey(this.getCtx(), biz, key));
  }
  // 切租户清理：只清当前租户的键？不——全清更安全,防止上个租户的敏感数据残留
  clearAll() {
    this.store.clear();
  }
  rawKeys(): string[] {
    return [...this.store.keys()];
  }
}

// ---- 断言 ----
const rootDomains = ["saas-app.com"];
// 子域名优先
console.assert(
  resolveTenant({ host: "acme.saas-app.com", pathname: "/t/beta/x", rootDomains })
    .tenantId === "acme",
  "子域名优先级高于路径",
);
// 保留子域不算租户 → 落到路径
console.assert(
  resolveTenant({ host: "app.saas-app.com", pathname: "/t/beta/x", rootDomains })
    .tenantId === "beta",
  "保留子域 app 不算租户,落路径解析",
);
// 多级子域（a.b.saas-app.com）不识别,防错判
console.assert(
  resolveTenant({ host: "a.b.saas-app.com", rootDomains }).tenantId === "default",
  "多级子域不解析为租户",
);
// header 与 query
console.assert(
  resolveTenant({ headerTenant: "t-hd", queryTenant: "t-q", rootDomains }).source ===
    "header",
  "header 优先于 query",
);
console.assert(
  resolveTenant({ queryTenant: "t-q", rootDomains }).tenantId === "t-q",
  "query 兜底",
);

// 请求注入
const ctx = resolveTenant({ host: "acme.saas-app.com", rootDomains });
const req = injectTenant({ url: "/api/orders", headers: {} }, ctx);
console.assert(req.headers["X-Tenant-Id"] === "acme", "注入租户头");
// 冲突拒绝
let conflictThrown = false;
try {
  injectTenant({ url: "/api/x", headers: { "X-Tenant-Id": "evil" } }, ctx);
} catch {
  conflictThrown = true;
}
console.assert(conflictThrown, "私货租户头必须被拒绝");

// 缓存隔离：同 key 不同租户互不覆盖
let current = ctx;
const storage = new TenantStorage(() => current);
storage.set("list", "page1", "acme-数据");
current = { tenantId: "beta", source: "path" };
storage.set("list", "page1", "beta-数据");
console.assert(
  storage.get("list", "page1") === "beta-数据",
  "当前租户读到自己的数据",
);
current = ctx;
console.assert(
  storage.get("list", "page1") === "acme-数据",
  "切回 acme 读到 acme 的数据",
);
console.assert(
  storage.rawKeys().every((k) => k.includes("::")),
  "所有缓存键带租户命名空间",
);
storage.clearAll();
console.assert(storage.rawKeys().length === 0, "切租户全量清理");

console.log("✅ 租户解析 / 请求注入 / 缓存隔离全部通过");
