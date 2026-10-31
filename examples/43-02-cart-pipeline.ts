// 文件: examples/43-02-cart-pipeline.ts
// ============ 购物车：价格计算管道 ============
// 购物车价格是一条**有序管道**：原价小计 → 满减 → 折扣 → 优惠券 → 兜底校验。
// 三个容易翻车的点：
// 1) 顺序敏感：先满减再折扣 ≠ 先折扣再满减——顺序是定价规则的一部分，必须显式固定；
// 2) 精度：0.1 + 0.2 !== 0.3，金额一律用「分」的整数运算，展示层才转元；
// 3) 分摊：优惠总额要按占比分摊到每个 item（退款按实付退），
//    最后一项用「总额减去已分摊」兜底，保证分摊和恰好等于优惠总额（无浮点尾巴）。

export interface CartItem {
  id: string;
  priceFen: number; // 单价（分）
  qty: number;
}

export type Promotion =
  | { kind: "fullcut"; label: string; everyFen: number; cutFen: number } // 每满 every 减 cut
  | { kind: "percent"; label: string; off: number } // 折扣，0.9 = 九折
  | { kind: "coupon"; label: string; amountFen: number }; // 定额券

export interface AppliedStep {
  label: string;
  deltaFen: number; // 负数 = 优惠
  afterFen: number; // 该步之后的应付
}

/** 原价小计（分） */
export function subtotalFen(items: readonly CartItem[]): number {
  return items.reduce((sum, it) => sum + it.priceFen * it.qty, 0);
}

/** 优惠分摊：按金额占比，最后一项兜底（保证 Σ分摊 = 总优惠） */
export function apportion(
  items: readonly CartItem[],
  totalDiscountFen: number,
): number[] {
  const total = subtotalFen(items);
  const shares = items.map((it) =>
    Math.floor((it.priceFen * it.qty * totalDiscountFen) / total),
  );
  shares[shares.length - 1] += totalDiscountFen - shares.reduce((a, b) => a + b, 0);
  return shares;
}

/** 有序价格管道：fullcut → percent → coupon，返回应付与明细 */
export function checkout(
  items: readonly CartItem[],
  promos: readonly Promotion[],
): { payableFen: number; steps: AppliedStep[] } {
  let current = subtotalFen(items);
  const steps: AppliedStep[] = [{ label: "原价小计", deltaFen: 0, afterFen: current }];

  for (const p of promos) {
    let delta = 0;
    if (p.kind === "fullcut") {
      // 按 every 周期循环减（每满 300 减 40，600 减 80）
      delta = -Math.floor(current / p.everyFen) * p.cutFen;
    } else if (p.kind === "percent") {
      delta = -Math.round(current * (1 - p.off));
    } else {
      delta = -Math.min(p.amountFen, current); // 券不超过应付
    }
    current += delta;
    steps.push({ label: p.label, deltaFen: delta, afterFen: current });
  }
  if (current < 0) {
    steps.push({ label: "兜底修正", deltaFen: -current, afterFen: 0 });
    current = 0;
  }
  return { payableFen: current, steps };
}

// ---------------- 验证 ----------------

const items: CartItem[] = [
  { id: "a", priceFen: 10050, qty: 1 }, // 100.50 元
  { id: "b", priceFen: 20000, qty: 1 }, // 200.00 元
  { id: "c", priceFen: 5025, qty: 1 }, // 50.25 元
];
const promos: Promotion[] = [
  { kind: "fullcut", label: "每满 300 减 40", everyFen: 30000, cutFen: 4000 },
  { kind: "percent", label: "会员 9 折", off: 0.9 },
  { kind: "coupon", label: "店铺券 30", amountFen: 3000 },
];

console.log("=== 标准顺序：满减 → 折扣 → 券 ===");
const r1 = checkout(items, promos);
for (const s of r1.steps)
  console.log(
    `  ${s.label}: ${s.deltaFen === 0 ? "" : `${s.deltaFen / 100} 元`} → 应付 ${(s.afterFen / 100).toFixed(2)}`,
  );

console.log("\n=== 顺序敏感：券 → 折扣 → 满减（结果不同） ===");
const r2 = checkout(items, [...promos].reverse());
console.log(`  标准顺序应付 ${(r1.payableFen / 100).toFixed(2)} / 反序应付 ${(r2.payableFen / 100).toFixed(2)}`);

console.log("\n=== 优惠分摊（退款按实付退） ===");
const totalDiscount = subtotalFen(items) - r1.payableFen;
const shares = apportion(items, totalDiscount);
items.forEach((it, i) =>
  console.log(
    `  ${it.id}: 原价 ${((it.priceFen * it.qty) / 100).toFixed(2)} → 实付 ${((it.priceFen * it.qty - shares[i]) / 100).toFixed(2)}（优惠 ${shares[i] / 100}）`,
  ),
);
console.log(
  "  分摊合计:",
  shares.reduce((a, b) => a + b, 0) / 100,
  "= 总优惠",
  totalDiscount / 100,
);
