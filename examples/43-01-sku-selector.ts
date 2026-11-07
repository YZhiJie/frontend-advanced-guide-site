// 文件: examples/43-01-sku-selector.ts
// ============ SKU 选择器：规格组合与无效置灰 ============
// 电商商品选择的经典问题：选了「红色」之后，「蓝色」按钮要不要置灰？
// 数据模型：每个 SKU = 一组规格值（颜色/尺码/…）+ 库存 + 价格。
// 判定规则（贪心超集检查）：
//   候选值 (dim, value) 可选 ⟺ 存在一个有库存的 SKU，
//   它的规格完全包含「当前已选 ∪ {候选值}」。
// 复杂度 O(SKU 数 × 规格维数)，SKU 几百个毫无压力；
// 更快的无向图连通法（预计算可达组合）见正文，思想相同。

export interface Sku {
  id: string;
  specs: Readonly<Record<string, string>>; // 维度 → 值，如 { 颜色: "红", 尺码: "L" }
  stock: number;
  price: number;
}

export type Selected = Readonly<Record<string, string>>;

/** specs 是否包含 selected 的全部键值（sku ⊇ selected） */
function covers(skuSpecs: Selected, selected: Selected): boolean {
  return Object.entries(selected).every(
    ([k, v]) => skuSpecs[k] === v,
  );
}

/** 候选值可选性：加入已选集合后，是否仍有有库存的 SKU 覆盖它 */
export function isSelectable(
  skus: readonly Sku[],
  selected: Selected,
  dim: string,
  value: string,
): boolean {
  const next: Selected = { ...selected, [dim]: value };
  return skus.some((s) => s.stock > 0 && covers(s.specs, next));
}

/** 全维度匹配：找到唯一 SKU（价格随之确定）；找不到返回 null */
export function findMatchedSku(
  skus: readonly Sku[],
  selected: Selected,
): Sku | null {
  return (
    skus.find(
      (s) =>
        s.stock > 0 &&
        Object.keys(s.specs).length === Object.keys(selected).length &&
        covers(s.specs, selected),
    ) ?? null
  );
}

/** 点击规格值：同维换选 / 再点取消；取消后其余维度保留 */
export function toggleSpec(
  selected: Selected,
  dim: string,
  value: string,
): Record<string, string> {
  const out: Record<string, string> = { ...selected };
  if (out[dim] === value) delete out[dim];
  else out[dim] = value;
  return out;
}

// ---------------- 验证 ----------------

const skus: Sku[] = [
  { id: "s1", specs: { 颜色: "红", 尺码: "M" }, stock: 3, price: 199 },
  { id: "s2", specs: { 颜色: "红", 尺码: "L" }, stock: 0, price: 199 }, // 红 L 无货
  { id: "s3", specs: { 颜色: "蓝", 尺码: "M" }, stock: 5, price: 179 },
  { id: "s4", specs: { 颜色: "蓝", 尺码: "L" }, stock: 2, price: 179 },
  { id: "s5", specs: { 颜色: "黑", 尺码: "M" }, stock: 1, price: 189 },
];

const dims = ["颜色", "尺码"];
const values: Record<string, string[]> = {
  颜色: ["红", "蓝", "黑"],
  尺码: ["M", "L"],
};

function renderMatrix(selected: Selected): void {
  console.log(`已选: ${JSON.stringify(selected) || "{}"}`);
  for (const dim of dims) {
    const row = values[dim]
      .map((v) => {
        if (selected[dim] === v) return `${v}✓`;
        return isSelectable(skus, selected, dim, v) ? v : `${v}(置灰)`;
      })
      .join("  ");
    console.log(`  ${dim}: ${row}`);
  }
  const sku = findMatchedSku(skus, selected);
  console.log(`  匹配 SKU: ${sku ? `${sku.id} ¥${sku.price}` : "未选全"}`);
}

console.log("=== 初始：全部可选 ===");
renderMatrix({});

console.log("\n=== 选「红」：红 L 无货 → L 置灰 ===");
let sel = toggleSpec({}, "颜色", "红");
renderMatrix(sel);

console.log("\n=== 换选「蓝」：L 恢复可选（蓝 L 有货） ===");
sel = toggleSpec(sel, "颜色", "蓝");
renderMatrix(sel);

console.log("\n=== 再点「蓝」取消选择 → 回到初始 ===");
sel = toggleSpec(sel, "颜色", "蓝");
renderMatrix(sel);

console.log("\n=== 选满「黑 M」→ 命中 SKU（库存 1） ===");
renderMatrix(toggleSpec(toggleSpec({}, "颜色", "黑"), "尺码", "M"));
