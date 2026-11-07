// 文件: examples/82-01-config-center.ts
// ============ 配置中心：三层合并 + 特性开关灰度 + 实时生效 ============
// 对应 JD「配置中心」。全局 > 租户 > 用户三层合并，特性开关按用户分桶灰度，
// 配置变更实时推送 + 版本回滚，硬断言直跑。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 三层配置模型与合并 ----------------

export interface AppConfig {
  theme: "light" | "dark";
  language: string;
  maxUploadSizeMB: number;
  features: Record<string, boolean>;
}

/** 三层配置：global（平台默认）> tenant（租户定制）> user（用户偏好） */
export interface ConfigLayers {
  global: Partial<AppConfig>;
  tenant: Partial<AppConfig>;
  user: Partial<AppConfig>;
}

/**
 * 合并规则：user > tenant > global。
 * 注意：features 这种对象类型要深合并（不是整体覆盖），
 * 否则租户关了 A 功能、用户开了 B 功能，合并后 A 会丢失。
 */
export function mergeConfig(layers: ConfigLayers): AppConfig {
  const merged: any = { ...layers.global };
  for (const layer of [layers.tenant, layers.user]) {
    for (const key of Object.keys(layer) as (keyof AppConfig)[]) {
      const val = (layer as any)[key];
      if (val === undefined) continue; // undefined 表示"不覆盖"，与 null 区分
      if (typeof val === "object" && !Array.isArray(val)) {
        merged[key] = { ...(merged[key] || {}), ...val };
      } else {
        merged[key] = val;
      }
    }
  }
  return merged as AppConfig;
}

// ---------------- 2. 特性开关 + 灰度分桶 ----------------

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  /** 灰度比例 0~100，按用户 ID 哈希分桶 */
  rolloutPercentage?: number;
  /** 白名单用户 ID 列表（无论比例都命中） */
  whitelist?: string[];
}

/**
 * 特性开关判定：
 * 1. 白名单用户直接命中；
 * 2. 否则按 rolloutPercentage 对 userId 哈希取模分桶；
 * 3. enabled=false 直接关闭。
 */
export function isFeatureOn(flag: FeatureFlag, userId: string): boolean {
  if (!flag.enabled) return false;
  if (flag.whitelist?.includes(userId)) return true;
  if (flag.rolloutPercentage === undefined || flag.rolloutPercentage >= 100) return true;
  if (flag.rolloutPercentage <= 0) return false;
  // 稳定哈希：同一个用户永远落在同一个桶，刷新不变
  const hash = stableHash(userId);
  return (hash % 100) < flag.rolloutPercentage;
}

/** 简单稳定哈希（非加密，仅用于分桶） */
function stableHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ---------------- 3. 配置变更实时推送与版本回滚 ----------------

export interface ConfigVersion {
  version: number;
  config: AppConfig;
  changedBy: string;
  changedAt: number;
  changelog: string;
}

/** 配置中心：维护版本链，支持回滚 + 变更通知 */
export class ConfigCenter {
  private versions: ConfigVersion[] = [];
  private current: AppConfig;
  private listeners = new Set<(cfg: AppConfig) => void>();

  constructor(initial: AppConfig) {
    this.current = initial;
    this.versions.push({ version: 1, config: { ...initial }, changedBy: "system", changedAt: Date.now(), changelog: "初始版本" });
  }

  get(): AppConfig {
    return this.current;
  }

  /** 发布新版本，通知所有监听者 */
  publish(config: AppConfig, by: string, changelog: string): ConfigVersion {
    const v: ConfigVersion = {
      version: this.versions.length + 1,
      config: { ...config },
      changedBy: by,
      changedAt: Date.now(),
      changelog,
    };
    this.versions.push(v);
    this.current = { ...config };
    this.listeners.forEach((fn) => fn(this.current));
    return v;
  }

  /** 回滚到指定版本，产生一个新版本（回滚操作本身也留痕） */
  rollback(version: number, by: string): ConfigVersion {
    const target = this.versions.find((v) => v.version === version);
    if (!target) throw new Error(`版本 ${version} 不存在`);
    return this.publish(target.config, by, `回滚到版本 ${version}`);
  }

  subscribe(fn: (cfg: AppConfig) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  history(): ConfigVersion[] {
    return [...this.versions].reverse();
  }
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. 三层配置合并（features 深合并） =====");
  const layers: ConfigLayers = {
    global: { theme: "light", language: "zh", maxUploadSizeMB: 10, features: { a: true, b: false, c: true } },
    tenant: { theme: "dark", features: { b: true } }, // 租户改主题、开 b 功能
    user: { language: "en", features: { c: false } }, // 用户改语言、关 c 功能
  };
  const merged = mergeConfig(layers);
  assert(merged.theme === "dark", "租户主题覆盖全局");
  assert(merged.language === "en", "用户语言覆盖租户/全局");
  assert(merged.maxUploadSizeMB === 10, "未覆盖的字段保留全局值");
  // features 深合并：a(全局true) b(租户true) c(用户false)
  assert(merged.features.a === true && merged.features.b === true && merged.features.c === false,
    `features 深合并错误: ${JSON.stringify(merged.features)}`);
  console.log(`✓ 合并结果: theme=${merged.theme}, lang=${merged.language}, features=${JSON.stringify(merged.features)}`);

  console.log("\n===== 2. 特性开关灰度分桶 =====");
  const flag: FeatureFlag = { key: "new-dashboard", enabled: true, rolloutPercentage: 50, whitelist: ["vip-001"] };
  // 白名单直接命中
  assert(isFeatureOn(flag, "vip-001") === true, "白名单用户直接命中");
  // 关闭状态下白名单也不命中
  assert(isFeatureOn({ ...flag, enabled: false }, "vip-001") === false, "enabled=false 时白名单也无效");
  // 同一个用户分桶稳定
  const u1 = isFeatureOn(flag, "user-abc");
  const u1Again = isFeatureOn(flag, "user-abc");
  assert(u1 === u1Again, "同一用户分桶结果必须稳定");
  console.log(`✓ 白名单命中、enabled 优先级最高、分桶稳定（user-abc: ${u1}）`);

  console.log("\n===== 3. 配置发布 + 实时订阅 + 版本回滚 =====");
  const center = new ConfigCenter({ theme: "light", language: "zh", maxUploadSizeMB: 10, features: {} });
  let notified: AppConfig | null = null;
  const unsub = center.subscribe((cfg) => { notified = cfg; });

  const v2 = center.publish({ ...center.get(), theme: "dark" }, "admin", "切换默认主题为深色");
  assert(v2.version === 2, "新版本号为 2");
  assert(notified?.theme === "dark", "订阅者收到变更通知");
  console.log(`✓ 发布 v2，订阅者收到 theme=${notified?.theme}`);

  // 回滚到 v1
  const v3 = center.rollback(1, "admin");
  assert(v3.version === 3, "回滚产生新版本 v3");
  assert(center.get().theme === "light", "回滚后主题回到 light");
  console.log(`✓ 回滚到 v1，当前版本 v3，theme=${center.get().theme}`);

  // 历史版本
  const history = center.history();
  assert(history.length === 3, `应有 3 个版本，实际 ${history.length}`);
  console.log(`✓ 版本历史共 ${history.length} 条: ${history.map((v) => `v${v.version}`).join(" → ")}`);

  unsub();
  console.log("\n✅ 三层配置合并 + 灰度分桶 + 实时订阅 + 版本回滚全部通过");
}

main();
