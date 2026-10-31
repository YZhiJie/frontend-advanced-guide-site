// 文件: examples/36-01-authn-authz.ts
// ============ 认证 vs 授权：两层分离 ============
// 认证（Authentication）回答"你是谁"，授权（Authorization）回答"你能干什么"。
// 两层必须分离：认证失败返回 401（未登录/凭证无效），授权失败返回 403（已登录但无权限）。
// 混用两者的典型错误：未登录也返回 403——前端无法区分"该去登录"还是"该提示无权限"。

export interface Identity {
    userId: string;
    name: string;
    /** 认证成功后由服务端下发的权限码列表（第 35 册的 RBAC 模型产出） */
    permissionCodes: string[];
}

/** 认证：校验凭证，产出身份。失败返回 null */
export function authenticate(username: string, password: string): Identity | null {
    // 模拟用户库（生产中凭证校验在服务端，密码必须 bcrypt/argon2 哈希存储）
    const users: Record<string, { password: string; identity: Identity }> = {
        alice: { password: "pw1", identity: { userId: "u1", name: "Alice", permissionCodes: ["user:view", "user:edit"] } },
        bob: { password: "pw2", identity: { userId: "u2", name: "Bob", permissionCodes: ["user:view"] } },
    };
    const hit = users[username];
    if (!hit || hit.password !== password) return null;
    return hit.identity;
}

/** 授权：基于身份做权限码匹配（与认证解耦，可独立单测） */
export function authorize(identity: Identity, requiredCode: string): boolean {
    return identity.permissionCodes.some(
        (code) => code === requiredCode || code.endsWith(":*") && requiredCode.startsWith(code.slice(0, -1)),
    );
}

/** 请求处理管线：先认证后授权，错误码语义分明 */
export function handleRequest(
    credentials: { username: string; password: string } | null,
    requiredCode: string,
): { status: 200 | 401 | 403; body: string } {
    if (!credentials) return { status: 401, body: "未提供凭证" };
    const identity = authenticate(credentials.username, credentials.password);
    if (!identity) return { status: 401, body: "凭证无效" };
    if (!authorize(identity, requiredCode)) return { status: 403, body: "无权限" };
    return { status: 200, body: `OK (${identity.name})` };
}

// ---------------- 验证 ----------------

console.log("=== 认证层 ===");
console.log("alice 登录:", authenticate("alice", "pw1")?.name); // Alice
console.log("错误密码:", authenticate("alice", "wrong")); // null

console.log("\n=== 401 vs 403 语义 ===");
console.log("无凭证:", handleRequest(null, "user:view")); // 401
console.log("凭证错误:", handleRequest({ username: "alice", password: "x" }, "user:view")); // 401
console.log("bob 改用户:", handleRequest({ username: "bob", password: "pw2" }, "user:edit")); // 403
console.log("alice 改用户:", handleRequest({ username: "alice", password: "pw1" }, "user:edit")); // 200

console.log("\n=== 授权可独立复用（不动认证） ===");
const bob = authenticate("bob", "pw2")!;
console.log("bob 能看用户?", authorize(bob, "user:view")); // true
console.log("bob 能删用户?", authorize(bob, "user:delete")); // false
