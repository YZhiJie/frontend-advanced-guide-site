// 文件: examples/72-04-permission-invalidation.ts
// ============ 权限变更一致性模拟：版本号 + 增量推送 + 缓存失效 ============
// 时序复现「旧权限缓存导致越权」：管理员收窄范围 → 推送丢失 → 客户端拿旧缓存放行；
// 再演示修复链路：请求带版本号 → 服务端发现漂移 → 客户端全量刷新 + 断线重连增量同步。

// ---------- 1. 服务端：权限中心（唯一事实来源） ----------

interface PermSnapshot {
  version: number;
  visibleDepts: string[];
}

class PermissionCenter {
  private table = new Map<string, PermSnapshot>();
  private timeline: string[] = [];

  set(userId: string, depts: string[]) {
    const prev = this.table.get(userId);
    const version = (prev?.version ?? 0) + 1;
    this.table.set(userId, { version, visibleDepts: depts });
    return { version, added: depts.filter((d) => !prev?.visibleDepts.includes(d)), removed: (prev?.visibleDepts ?? []).filter((d) => !depts.includes(d)) };
  }

  get(userId: string): PermSnapshot {
    return this.table.get(userId)!;
  }

  /** 模拟后端接口：数据访问永远以服务端当前版本为准（前端缓存只是体验层） */
  serve(userId: string, deptId: string, clientVersion: number): { status: number; permVersion: number } {
    const cur = this.get(userId);
    if (clientVersion !== cur.version) {
      this.timeline.push(`服务端发现版本漂移: 客户端 v${clientVersion} vs 服务端 v${cur.version}`);
      // 不直接放行，也不直接拒绝业务——先要求客户端对齐版本（真实系统里照常判定 + 响应头带当前版本）
    }
    const ok = cur.visibleDepts.includes(deptId);
    return { status: ok ? 200 : 403, permVersion: cur.version };
  }

  log(line: string) {
    this.timeline.push(line);
  }

  get logs() {
    return this.timeline;
  }
}

// ---------- 2. 传输层：会丢消息的 WebSocket ----------

class PushChannel {
  private queue: Array<(msg: { userId: string; version: number }) => void> = [];
  connected = true;

  onMessage(fn: (msg: { userId: string; version: number }) => void) {
    this.queue.push(fn);
  }

  push(userId: string, version: number) {
    if (!this.connected) return; // 断线期间推送直接丢失——真实弱网/切后台就是这样
    for (const fn of this.queue) fn({ userId, version });
  }
}

// ---------- 3. 客户端：内存权限缓存 ----------

class PermClient {
  cache: PermSnapshot;
  constructor(
    private userId: string,
    private center: PermissionCenter,
    channel: PushChannel,
  ) {
    this.cache = center.get(userId); // 登录时全量拉取
    channel.onMessage((msg) => {
      if (msg.userId !== this.userId) return;
      // 增量推送到达：真实实现里拉 diff，这里简化为版本变了就全量重拉
      this.cache = this.center.get(this.userId);
    });
  }

  /** 体验层判定：菜单/按钮/预过滤都问本地缓存——快，但可能过期 */
  canSee(deptId: string): boolean {
    return this.cache.visibleDepts.includes(deptId);
  }

  /** 发起数据请求：带本地权限版本，让服务端有机会发现漂移 */
  request(deptId: string): { status: number; drift: boolean } {
    const res = this.center.serve(this.userId, deptId, this.cache.version);
    if (res.permVersion !== this.cache.version) {
      this.cache = this.center.get(this.userId); // 版本漂移 → 全量刷新缓存
      return { status: res.status, drift: true };
    }
    return { status: res.status, drift: false };
  }

  /** 断线重连后的主动对齐：不能信推送一定到过 */
  resync() {
    this.cache = this.center.get(this.userId);
  }
}

// ---------- 4. 时序演示 ----------

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const center = new PermissionCenter();
const channel = new PushChannel();
center.set("u3", ["d11", "d111", "d112"]); // v1：事业部及下级
const client = new PermClient("u3", center, channel);

center.log("T1 登录: 客户端缓存 v1 = [d11, d111, d112]");
assert(client.cache.version === 1 && client.canSee("d111"), "初始缓存 v1");

// T2 管理员把张经理收窄为「仅本部 d11」，版本升到 v2；此刻客户端断线，推送丢失
channel.connected = false;
const diff = center.set("u3", ["d11"]);
channel.push("u3", diff.version);
center.log("T2 管理员收窄范围: v2 = [d11]，但客户端断线，推送丢失");
assert(diff.removed.join() === "d111,d112", "diff 算出被移除的部门");
assert(client.cache.version === 1, "推送丢失，客户端仍是 v1");

// T3 【复现】旧缓存越权：体验层仍认为能看到 d111
assert(client.canSee("d111"), "越权复现：旧缓存把已收回的 d111 判成可见");
center.log("T3 旧缓存放行 d111 → 越权复现（体验层失守）");

// T4 但真实数据请求到服务端：服务端按 v2 判定，403 拦截 + 暴露版本漂移
const res = client.request("d111");
assert(res.status === 403 && res.drift, "服务端按当前版本拒绝，并触发客户端全量刷新");
assert(client.cache.version === 2 && !client.canSee("d111"), "刷新后缓存对齐 v2");
center.log("T4 服务端 403 拦截 + 版本漂移 → 客户端全量刷新到 v2");

// T5 断线重连的兜底：重连时主动 resync，不等下一次请求撞版本
channel.connected = true;
center.set("u3", ["d11", "d111"]); // v3：又放回 d111，推送再次丢失不影响结论
channel.connected = false;
channel.push("u3", 3);
assert(client.cache.version === 2, "v3 推送再次丢失");
channel.connected = true;
client.resync();
assert(client.cache.version === 3 && client.canSee("d111"), "重连 resync 拉到 v3");
center.log("T5 重连主动 resync → v3 生效");

console.log("=== 事件时间线 ===");
for (const line of center.logs) console.log(" " + line);
console.log("\n最终状态: 客户端缓存 v" + client.cache.version + " =", client.cache.visibleDepts.join(", "));
console.log("✅ 越权复现 / 服务端兜底 / 版本对齐 / 重连 resync 全部通过");
