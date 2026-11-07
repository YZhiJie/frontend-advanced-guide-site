// 文件: examples/77-02-gpu-layer-budget.ts
// ============ 合成层预算器：显存估算 + 提升决策 + 动画属性分级 ============
// 把 77.2 的「GPU 加速不是免费午餐」量化：每个合成层都要分配一张纹理（显存），
// 面积 × DPR² × 4 字节就是成本；本示例给出「该不该提升为合成层」的可执行决策规则，
// 并对动画属性做 composite / paint / layout 三级分类，防止把重排动画伪装成 GPU 加速。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 显存成本模型 ----------------

/** RGBA8888：每像素 4 字节；DPR=2 时物理像素是逻辑像素的 4 倍 */
function layerMemoryMb(width: number, height: number, dpr: number): number {
  const bytes = width * dpr * height * dpr * 4;
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

// 1920×1080 @2x 全屏层 = 1920*2 * 1080*2 * 4 ≈ 31.64MB（1MB = 1024*1024）
assert(layerMemoryMb(1920, 1080, 2) === 31.64, "全屏 1080p@2x 合成层应约 31.64MB");
assert(layerMemoryMb(320, 120, 2) === 0.59, "320×120@2x 小卡片应约 0.59MB");

// ---------------- 2. 动画属性三级分类 ----------------

type AnimationCost = "composite" | "paint" | "layout";

/** 只有 transform / opacity 能真正走 GPU 合成，其余属性都要重新绘制甚至重排 */
function classifyAnimationProperty(prop: string): AnimationCost {
  if (prop === "transform" || prop === "opacity") return "composite";
  if (prop === "filter" || prop === "backdrop-filter" || prop === "box-shadow") return "paint";
  return "layout";
}

assert(classifyAnimationProperty("transform") === "composite", "transform 应为 composite");
assert(classifyAnimationProperty("top") === "layout", "top 动画应触发 layout");
assert(classifyAnimationProperty("filter") === "paint", "filter 动画应触发 paint");

// ---------------- 3. 提升决策：收益 / 成本 / 时长 / 总量四道门 ----------------

interface PromotionInput {
  width: number;
  height: number;
  dpr: number;
  /** 动画预计持续时长；常驻动画 ≈ Infinity */
  durationMs: number;
  property: string;
  /** 当前页面已存在的合成层数量 */
  existingLayers: number;
  /** 设备档位：低端机显存与填充率都更紧张 */
  tier: "high" | "low";
}

interface PromotionDecision {
  promote: boolean;
  memoryMb: number;
  reason: string;
}

/** 单层显存上限：低端机 8MB，高端机 16MB */
const LAYER_MEMORY_LIMIT: Record<PromotionInput["tier"], number> = { high: 16, low: 8 };
/** 页面合成层总量上限：超过后每层都分摊 GPU 带宽与内存，收益迅速衰减 */
const MAX_LAYERS = 12;

function decidePromotion(input: PromotionInput): PromotionDecision {
  const memoryMb = layerMemoryMb(input.width, input.height, input.dpr);
  const cost = classifyAnimationProperty(input.property);

  if (cost === "layout") {
    return { promote: false, memoryMb, reason: "动画属性触发重排，提升合成层无法消除布局成本" };
  }
  if (cost === "paint" && input.tier === "low") {
    return { promote: false, memoryMb, reason: "低端机滤镜类动画填充率开销高，建议改为静态遮罩或降级" };
  }
  if (input.durationMs > 2000) {
    return { promote: false, memoryMb, reason: "动画过长，应改为瞬时反馈或按需启停 will-change" };
  }
  if (memoryMb > LAYER_MEMORY_LIMIT[input.tier]) {
    return { promote: false, memoryMb, reason: `单层 ${memoryMb}MB 超过 ${input.tier} 档上限 ${LAYER_MEMORY_LIMIT[input.tier]}MB` };
  }
  if (input.existingLayers >= MAX_LAYERS) {
    return { promote: false, memoryMb, reason: `合成层已达 ${MAX_LAYERS} 层，继续提升会挤占 GPU 带宽` };
  }
  return { promote: true, memoryMb, reason: "面积可控 + 合成属性 + 短时动画，允许提升" };
}

// ---------------- 4. 一组真实风格的动画计划，逐个决策 ----------------

const plans: PromotionInput[] = [
  { width: 320, height: 120, dpr: 2, durationMs: 300, property: "transform", existingLayers: 2, tier: "low" },
  { width: 1920, height: 1080, dpr: 2, durationMs: 400, property: "opacity", existingLayers: 2, tier: "high" },
  { width: 640, height: 480, dpr: 2, durationMs: 300, property: "top", existingLayers: 2, tier: "high" },
  { width: 800, height: 600, dpr: 2, durationMs: 600, property: "filter", existingLayers: 2, tier: "low" },
  { width: 200, height: 80, dpr: 2, durationMs: 5000, property: "transform", existingLayers: 2, tier: "high" },
  { width: 320, height: 120, dpr: 2, durationMs: 300, property: "transform", existingLayers: 12, tier: "high" },
];

console.log("=== 合成层提升决策 ===");
console.table(
  plans.map((p) => ({
    size: `${p.width}×${p.height}@${p.dpr}x`,
    property: p.property,
    durationMs: p.durationMs,
    tier: p.tier,
    ...decidePromotion(p),
  })),
);

const totalMb =
  Math.round(
    plans
      .map((p) => decidePromotion(p))
      .filter((d) => d.promote)
      .reduce((sum, d) => sum + d.memoryMb, 0) * 100,
  ) / 100;

console.log(`\n允许提升的层显存合计：${totalMb}MB`);

// ---------------- 5. 硬断言 ----------------

// 小卡片短时 transform：允许
assert(decidePromotion(plans[0]).promote, "小面积短时 transform 应允许提升");
// 全屏 opacity @2x：31.64MB 超过高端机 16MB 上限
const fullscreen = decidePromotion(plans[1]);
assert(!fullscreen.promote && fullscreen.memoryMb > 16, "全屏大层应因显存超限被拒绝");
// top 动画：重排属性，提升无效
assert(!decidePromotion(plans[2]).promote, "top 动画不应靠合成层优化");
// 低端机 filter：填充率过高
assert(!decidePromotion(plans[3]).promote, "低端机 filter 动画应降级");
// 5 秒长动画：违背短时启停原则
assert(!decidePromotion(plans[4]).promote, "长时 transform 动画不应常驻提升");
// 已达 12 层：总量门拦截
assert(!decidePromotion(plans[5]).promote, "合成层总量超限应拒绝继续提升");

console.log("\n✅ 合成层预算示例全部断言通过");
