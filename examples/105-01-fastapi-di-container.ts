// 文件: examples/105-01-fastapi-di-container.ts
// 模拟 FastAPI 的依赖注入（Depends + Header + Query + Body）
// 核心：参数配置对象 → 框架自动解析并注入

import assert from "node:assert";

type Source = "header" | "query" | "body" | "depends";

interface ParamDef {
  source: Source;
  name?: string;
  factory?: (req: MockRequest) => any;
}

interface MockRequest {
  headers: Record<string, string>;
  query: Record<string, string>;
  body: any;
}

type Handler = (...args: any[]) => any;

class Router {
  private routes: Array<{ method: string; path: RegExp; params: ParamDef[]; handler: Handler }> = [];

  private toRegex(path: string): RegExp {
    return new RegExp(`^${path.replace(/\{(\w+)\}/g, "[^/]+")}$`);
  }

  /** 注册路由：params 数组定义每个参数的来源 */
  get(path: string, params: ParamDef[], handler: Handler) {
    this.routes.push({ method: "GET", path: this.toRegex(path), params, handler });
  }
  post(path: string, params: ParamDef[], handler: Handler) {
    this.routes.push({ method: "POST", path: this.toRegex(path), params, handler });
  }

  async handle(method: string, path: string, req: MockRequest): Promise<any> {
    const route = this.routes.find((r) => r.method === method && r.path.test(path));
    if (!route) return { error: "Not Found" };

    const args: any[] = route.params.map((p) => {
      switch (p.source) {
        case "header": return req.headers[p.name!] ?? null;
        case "query":  return req.query[p.name!] ?? null;
        case "body":   return req.body;
        case "depends": return p.factory ? p.factory(req) : null;
      }
    });

    return await route.handler(...args);
  }
}

// ---------- 便捷工厂（类似 FastAPI 的 Header/Query/Depends）----------
const H = (name: string): ParamDef => ({ source: "header", name });
const Q = (name: string): ParamDef => ({ source: "query", name });
const B = (): ParamDef => ({ source: "body" });
const D = (factory: (req: MockRequest) => any): ParamDef => ({ source: "depends", factory });

// ---------- 断言验证 ----------
async function runAssertions() {
  const app = new Router();

  // 依赖：获取当前用户（类似 FastAPI Depends）
  const getCurrentUser = (req: MockRequest) =>
    req.headers["authorization"] ? { id: 1, name: "Alice" } : null;

  // 路由 1：Header + Depends（类似 GET /users/me）
  app.get("/users/me",
    [H("x-request-id"), D(getCurrentUser)],
    (reqId: string | null, user: { id: number; name: string } | null) => ({ reqId, user })
  );

  // 路由 2：Query（类似 GET /search?q=xxx&page=2）
  app.get("/search",
    [Q("q"), Q("page")],
    (q: string | null, page: string | null) => ({ q, page: Number(page) || 1 })
  );

  // 路由 3：Body（类似 POST /users）
  app.post("/users",
    [B()],
    (body: { username: string }) => ({ created: body.username })
  );

  // 测试 1：带认证请求
  const r1 = await app.handle("GET", "/users/me", {
    headers: { "x-request-id": "abc123", "authorization": "Bearer xxx" },
    query: {}, body: null,
  });
  assert.equal(r1.user?.name, "Alice");
  assert.equal(r1.reqId, "abc123");
  console.log("[1/4] Header + Depends 注入 OK");

  // 测试 2：未登录请求
  const r2 = await app.handle("GET", "/users/me", { headers: {}, query: {}, body: null });
  assert.equal(r2.user, null);
  console.log("[2/4] Depends 未登录返回 null OK");

  // 测试 3：Query 参数
  const r3 = await app.handle("GET", "/search", {
    headers: {}, query: { q: "fastapi", page: "2" }, body: null,
  });
  assert.equal(r3.q, "fastapi");
  assert.equal(r3.page, 2);
  console.log("[3/4] Query 注入 OK");

  // 测试 4：Body 参数
  const r4 = await app.handle("POST", "/users", {
    headers: {}, query: {}, body: { username: "bob", email: "bob@test.com" },
  });
  assert.equal(r4.created, "bob");
  console.log("[4/4] Body 注入 OK");

  console.log("\n✅ 105-01 FastAPI 依赖注入容器 全部断言通过");
}

runAssertions().catch((e) => { console.error("断言失败:", e.message); process.exit(1); });
