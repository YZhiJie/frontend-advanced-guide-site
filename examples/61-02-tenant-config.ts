/** 61-02-tenant-config.ts —— 租户配置三层合并 + 特性开关判定（平台默认 → 租户覆盖 → 用户偏好） */

type Json = Record<string, unknown>;

// 深合并：只覆盖"叶子值",数组与对象按语义处理——数组整体替换,对象递归
// 关键纪律：null 是显式"清除",undefined 是"没配,跳过"
function deepMerge(base: Json, override: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue; // 未配置：保留下层值
    if (v === null) {
      delete out[k]; // 显式清除
      continue;
    }
    const bv = out[k];
    if (isPlain(v) && isPlain(bv)) {
      out[k] = deepMerge(bv as Json, v as Json);
    } else {
      out[k] = v; // 叶子值/数组：整体覆盖
    }
  }
  return out;
}
const isPlain = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// 三层配置：平台默认 < 租户覆盖 < 用户偏好
function resolveConfig(platform: Json, tenant: Json, user: Json): Json {
  return deepMerge(deepMerge(platform, tenant), user);
}

// 特性开关三级判定：用户 > 租户 > 平台;任一层显式 false 即最终 false（禁用一个特性不需要每层都关）
interface FlagRule {
  enabled?: boolean; // undefined=未配置
  rollout?: number; // 0-100 灰度百分比
}
function isFeatureOn(
  flag: string,
  layers: { platform: FlagRule; tenant: FlagRule; user: FlagRule },
  userIdHash: number, // 0-99 稳定分桶值（见 43 册 A/B 稳定分桶）
): boolean {
  // 自顶向下找第一个"显式配置"
  for (const layer of [layers.user, layers.tenant, layers.platform]) {
    if (layer.enabled === undefined) continue;
    if (layer.enabled === false) return false;
    // enabled=true 且带灰度：看用户落在不在桶里
    if (layer.rollout !== undefined && userIdHash >= layer.rollout) return false;
    return true;
  }
  return false; // 三层都没配：默认关（安全侧）
}

// ---- 断言 ----
// 深合并语义
const merged = deepMerge(
  { theme: { primary: "#0f0", radius: 4 }, modules: ["a", "b"], paged: true },
  { theme: { primary: "#f00" }, modules: ["c"], paged: undefined },
);
console.assert(
  (merged.theme as Json).primary === "#f00" &&
    (merged.theme as Json).radius === 4,
  "对象递归合并：覆盖叶子,保留兄弟",
);
console.assert(
  JSON.stringify(merged.modules) === '["c"]',
  "数组整体替换不拼接",
);
console.assert(merged.paged === true, "undefined 不覆盖下层");
// null 显式清除
const cleared = deepMerge({ announcement: "大家好", x: 1 }, { announcement: null });
console.assert(!("announcement" in cleared) && cleared.x === 1, "null 清除键");

// 三层配置链
const cfg = resolveConfig(
  { theme: { primary: "#1677ff", logo: "platform.png" }, pageSize: 20 },
  { theme: { primary: "#722ed1" } }, // 租户只改品牌色
  { pageSize: 50 }, // 用户只改分页大小
);
console.assert(
  (cfg.theme as Json).primary === "#722ed1" &&
    (cfg.theme as Json).logo === "platform.png" &&
    cfg.pageSize === 50,
  "三层各改一处,合并后各取最高优先级",
);

// 特性开关：租户开 50% 灰度,用户层显式关
console.assert(
  isFeatureOn(
    "newDashboard",
    {
      platform: { enabled: false },
      tenant: { enabled: true, rollout: 50 },
      user: {},
    },
    30,
  ) === true,
  "租户开灰度,桶内用户可用",
);
console.assert(
  isFeatureOn(
    "newDashboard",
    {
      platform: { enabled: false },
      tenant: { enabled: true, rollout: 50 },
      user: {},
    },
    80,
  ) === false,
  "桶外用户不可用",
);
console.assert(
  isFeatureOn(
    "newDashboard",
    {
      platform: { enabled: true },
      tenant: {},
      user: { enabled: false },
    },
    0,
  ) === false,
  "用户层显式关 → 最终关",
);
console.assert(
  isFeatureOn("unknown", { platform: {}, tenant: {}, user: {} }, 0) === false,
  "未配置的开关默认关",
);

console.log("✅ 配置三层合并 / 特性开关三级判定全部通过");
