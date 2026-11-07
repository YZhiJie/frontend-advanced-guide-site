// 文件: examples/73-01-capability-layer.ts
// ============ 端能力抽象层:接口定义 + 三端 adapter + has() 探测 + 三级降级链 ============
// 设计要点:
// 1. 业务代码只依赖「能力接口」,不感知自己跑在哪个端;端差异全部收敛在 adapter 里
// 2. 用 has() 问「这个端有没有某能力」,而不是问「当前是不是某个端」——拒绝 UA 判断
// 3. 三级降级链:原生能力 → Web 降级 → 功能隐藏;降级是显式决策,不是 try/catch 兜底

/** 断言工具:契约不成立直接抛错,让示例在门禁里「红得响亮」 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------- services 层:能力接口定义(纯类型,零平台 API) ----------

/** 存储能力:三端语义必须一致,实现完全不同 */
interface StorageCapability {
  /** 实现来源标识,便于观测当前落在哪一级实现上 */
  readonly kind: "native-file" | "web-localstorage" | "bridge-proxy" | "memory-fallback";
  /** 标称容量(MB),业务可据此决定草稿/附件要不要瘦身 */
  readonly quotaMB: number;
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

/** 通知能力:返回实际投递通道,业务可感知「通知是否真的出去了」 */
interface NotificationCapability {
  readonly kind: "system" | "web-api" | "bridge-push";
  notify(title: string, body: string): Promise<"shown" | "denied">;
}

/** 应用内轻提示:降级链的最后一道「看得见的兜底」 */
interface ToastCapability {
  readonly kind: "toast";
  show(text: string): void;
}

// ---------- 能力宿主:注册表 + has() 探测 ----------

type CapabilityName = "storage" | "notification" | "toast";

class CapabilityHost {
  constructor(
    public readonly platform: "desktop" | "web" | "h5",
    private readonly registry: Partial<{
      storage: StorageCapability;
      notification: NotificationCapability;
      toast: ToastCapability;
    }>,
  ) {}

  /** 能力探测:运行期问「有没有」,与端类型解耦 */
  has(name: CapabilityName): boolean {
    return this.registry[name] !== undefined;
  }

  storage(): StorageCapability {
    const s = this.registry.storage;
    if (!s) throw new Error("当前端未注册 storage 能力,业务应在上游做降级");
    return s;
  }

  notification(): NotificationCapability | undefined {
    return this.registry.notification;
  }
}

// ---------- adapters 层:三端实现(每端一个文件,core 永远不许 import) ----------

/** PC 客户端(Tauri/Electron 壳):走原生文件系统,容量大、写入可靠 */
class DesktopStorageAdapter implements StorageCapability {
  readonly kind = "native-file" as const;
  readonly quotaMB = 1024;
  private files = new Map<string, string>(); // 模拟原生文件读写
  async set(key: string, value: string) {
    this.files.set(key, value);
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}

/** Web 浏览器:localStorage,约 5MB,隐私模式下可能写不进去 */
class WebStorageAdapter implements StorageCapability {
  readonly kind = "web-localstorage" as const;
  readonly quotaMB = 5;
  private store = new Map<string, string>(); // 模拟 localStorage
  async set(key: string, value: string) {
    this.store.set(key, value);
  }
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async remove(key: string) {
    this.store.delete(key);
  }
}

/** 移动 H5(有 JSBridge):WebView 存储随时可能被系统清空,代理给 Native 落库 */
class H5BridgeStorageAdapter implements StorageCapability {
  readonly kind = "bridge-proxy" as const;
  readonly quotaMB = 50;
  private nativeDb = new Map<string, string>(); // 模拟 Native 侧 SQLite
  async set(key: string, value: string) {
    this.nativeDb.set(key, value); // 真实环境是 await bridge.invoke("storage.set", ...)
  }
  async get(key: string) {
    return this.nativeDb.get(key) ?? null;
  }
  async remove(key: string) {
    this.nativeDb.delete(key);
  }
}

/** 移动 H5(桥不可用的极端情况):内存兜底,重启即丢——但必须让业务「知道自己不可靠」 */
class MemoryFallbackStorageAdapter implements StorageCapability {
  readonly kind = "memory-fallback" as const;
  readonly quotaMB = 0; // 标 0 是契约:告诉业务「不要往这里放任何重要数据」
  private mem = new Map<string, string>();
  async set(key: string, value: string) {
    this.mem.set(key, value);
  }
  async get(key: string) {
    return this.mem.get(key) ?? null;
  }
  async remove(key: string) {
    this.mem.delete(key);
  }
}

class DesktopNotificationAdapter implements NotificationCapability {
  readonly kind = "system" as const;
  async notify() {
    return "shown" as const; // 系统级通知,无需授权
  }
}

/** Web Notification API:需要用户授权,被拒时返回 denied 交给降级链 */
class WebNotificationAdapter implements NotificationCapability {
  readonly kind = "web-api" as const;
  constructor(private granted: boolean) {}
  async notify() {
    return this.granted ? ("shown" as const) : ("denied" as const);
  }
}

class H5BridgeNotificationAdapter implements NotificationCapability {
  readonly kind = "bridge-push" as const;
  async notify() {
    return "shown" as const; // 走 Native 推送通道
  }
}

class ToastAdapter implements ToastCapability {
  readonly kind = "toast" as const;
  constructor(private sink: string[]) {}
  show(text: string) {
    this.sink.push(text);
  }
}

// ---------- 三级降级链:原生能力 → Web 降级 → 功能隐藏 ----------

type NotifyOutcome =
  | { level: "native"; channel: string }
  | { level: "web-fallback"; channel: "toast" }
  | { level: "hidden" };

async function notifyWithFallback(host: CapabilityHost, toastSink: string[], title: string): Promise<NotifyOutcome> {
  // 第一级:原生/桥接通知能力
  const n = host.notification();
  if (n) {
    const r = await n.notify(title, "");
    if (r === "shown") return { level: "native", channel: n.kind };
    // denied → 落到第二级
  }
  // 第二级:Web 降级——页面内 toast,至少让用户看得见
  if (host.has("toast")) {
    toastSink.push(title);
    return { level: "web-fallback", channel: "toast" };
  }
  // 第三级:功能隐藏——入口按钮都不渲染,而不是点了没反应
  return { level: "hidden" };
}

// ---------- core 层:同一段业务代码,三端原样复用 ----------

class DraftService {
  constructor(private host: CapabilityHost) {}
  /** 保存草稿:不关心底层是文件、localStorage 还是 Native 库,但要响应容量契约 */
  async saveDraft(id: string, content: string): Promise<{ impl: string; persisted: boolean }> {
    const s = this.host.storage();
    // quotaMB 标 0 是 adapter 在明示「我不可靠」:业务显式放弃落盘,而不是假装存了
    if (s.quotaMB === 0) return { impl: s.kind, persisted: false };
    assert(content.length / 1024 / 1024 <= s.quotaMB, `草稿超出 ${s.kind} 的容量标称`);
    await s.set(`draft:${id}`, content);
    return { impl: s.kind, persisted: true };
  }
  async loadDraft(id: string): Promise<string | null> {
    return this.host.storage().get(`draft:${id}`);
  }
}

// ---------- 演示:同一业务场景在四种运行环境的行为 ----------

async function main() {
  const toastSink: string[] = [];

  const desktop = new CapabilityHost("desktop", {
    storage: new DesktopStorageAdapter(),
    notification: new DesktopNotificationAdapter(),
  });
  const web = new CapabilityHost("web", {
    storage: new WebStorageAdapter(),
    notification: new WebNotificationAdapter(false), // 模拟用户拒绝了授权
    toast: new ToastAdapter(toastSink),
  });
  const h5Bridged = new CapabilityHost("h5", {
    storage: new H5BridgeStorageAdapter(),
    notification: new H5BridgeNotificationAdapter(),
  });
  const h5NoBridge = new CapabilityHost("h5", {
    storage: new MemoryFallbackStorageAdapter(), // 桥挂了,只剩内存兜底
    toast: new ToastAdapter(toastSink),
  });

  console.log("== 场景:同一段 DraftService 代码跑在四种环境 ==\n");
  for (const host of [desktop, web, h5Bridged, h5NoBridge]) {
    const drafts = new DraftService(host);
    const saved = await drafts.saveDraft("mail-42", "Q3  OKR 初稿……");
    const loaded = await drafts.loadDraft("mail-42");
    const outcome = await notifyWithFallback(host, toastSink, "草稿已自动保存");
    console.log(
      `[${host.platform}${host === h5NoBridge ? "·无桥" : host === h5Bridged ? "·有桥" : ""}]` +
        ` 存储实现=${saved.impl} 读回=${saved.persisted ? (loaded === "Q3  OKR 初稿……" ? "一致" : "丢失") : "放弃落盘(仅内存)"}` +
        ` 通知=${outcome.level === "native" ? `原生通道(${(outcome as { channel: string }).channel})` : outcome.level === "web-fallback" ? "降级为页面 toast" : "功能隐藏"}`,
    );
  }

  console.log(`\ntoast 兜底共触发 ${toastSink.length} 次(web 被拒授权 1 次 + h5 无桥 1 次)`);

  // 硬断言:降级链的行为必须符合预期,否则示例红掉
  assert(toastSink.length === 2, "web 拒绝授权与 h5 无桥都应落到 toast 降级");
  assert(new DraftService(h5NoBridge).host.has("notification") === false, "无桥 H5 不应伪装有通知能力");
  const hiddenProbe = new CapabilityHost("h5", {}); // 连 toast 都没有的极端环境
  const hidden = await notifyWithFallback(hiddenProbe, toastSink, "测试");
  assert(hidden.level === "hidden", "两级能力都缺失时必须显式隐藏功能");

  console.log("✅ 端能力抽象层演示通过:同一业务代码,四种环境行为可预期、可观测");
}

main();
