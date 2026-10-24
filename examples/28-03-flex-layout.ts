// 文件: examples/28-03-flex-layout.ts
// ============ Flex 主轴空间分配 ============
// 三步：① 按 flex-basis 给基础宽度；② 有剩余按 flex-grow 分；③ 不够按 flex-shrink×basis 加权缩。
// 再叠加 justify-content 定位。

export interface Box {
  width: number;
  style: Map<string, string>;
  x: number;
}

function p(box: Box, prop: string) { return box.style.get(prop); }

// 解析 flex 简写: flex: <grow> <shrink> <basis>
function flexProps(box: Box) {
  let grow = 0, shrink = 1, basis: number | "auto" = "auto";
  const f = p(box, "flex");
  if (f) {
    const t = f.trim().split(/\s+/);
    if (t.length === 1) {
      if (t[0] === "auto") { grow = 1; shrink = 1; basis = "auto"; }
      else if (t[0] === "none") { grow = 0; shrink = 0; basis = "auto"; }
      else grow = parseFloat(t[0]) || 0;
    } else if (t.length === 2) {
      grow = parseFloat(t[0]) || 0;
      if (t[1] === "auto") basis = "auto"; else shrink = parseFloat(t[1]) || 0;
    } else {
      grow = parseFloat(t[0]) || 0; shrink = parseFloat(t[1]) || 0;
      const b = parseFloat(t[2]); basis = isNaN(b) ? "auto" : b;
    }
  } else {
    grow = parseFloat(p(box, "flex-grow") ?? "0") || 0;
    shrink = parseFloat(p(box, "flex-shrink") ?? "1") || 1;
    const b = p(box, "flex-basis");
    if (b && b !== "auto") basis = parseFloat(b) || 0;
  }
  return { grow, shrink, basis };
}

function mainSize(box: Box, basis: number | "auto") {
  return basis === "auto" ? box.width : basis;
}

interface LineEntry { box: Box; grow: number; shrink: number; base: number; }

// 主轴空间分配
function distribute(items: LineEntry[], avail: number): void {
  const totalBasis = items.reduce((s, e) => s + e.base, 0);
  const free = avail - totalBasis;

  if (free >= 0) {
    const totalGrow = items.reduce((s, e) => s + e.grow, 0);
    if (totalGrow > 0) {
      for (const e of items) {
        e.box.width = e.base + (free * e.grow) / totalGrow;
      }
    } else {
      for (const e of items) e.box.width = e.base;
    }
  } else {
    const deficit = -free;
    const weighted = items.reduce((s, e) => s + e.base * (e.shrink > 0 ? e.shrink : 0), 0);
    if (weighted > 0) {
      for (const e of items) {
        const share = e.shrink > 0 ? (deficit * e.base * e.shrink) / weighted : 0;
        e.box.width = Math.max(0, e.base - share);
      }
    } else {
      for (const e of items) e.box.width = e.base;
    }
  }
}

// justify-content 定位
function position(items: LineEntry[], avail: number, jc: string): void {
  const used = items.reduce((s, e) => s + e.box.width, 0);
  const free = avail - used;
  let start = 0, step = 0;
  switch (jc) {
    case "flex-start": start = 0; break;
    case "flex-end": start = free; break;
    case "center": start = free / 2; break;
    case "space-between": start = 0; step = free / Math.max(1, items.length - 1); break;
    case "space-around": start = free / (2 * items.length); step = free / items.length; break;
    case "space-evenly": start = free / (items.length + 1); step = free / (items.length + 1); break;
  }
  let cur = start;
  for (const e of items) { e.box.x = cur; cur += e.box.width + step; }
}

export function layoutFlex(containerWidth: number, boxes: Box[], justifyContent = "flex-start"): void {
  const entries: LineEntry[] = boxes.map((box) => {
    const { grow, shrink, basis } = flexProps(box);
    return { box, grow, shrink, base: mainSize(box, basis) };
  });
  distribute(entries, containerWidth);
  position(entries, containerWidth, justifyContent);
}

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

function box(width: number, style: Record<string, string>): Box {
  return { width, style: new Map(Object.entries(style)), x: 0 };
}

function print(title: string, boxes: Box[]) {
  console.log(`\n=== ${title} ===`);
  boxes.forEach((b, i) => console.log(`  item${i + 1}: width=${b.width.toFixed(1)}  x=${b.x.toFixed(1)}`));
}

// 场景 1：flex:1 等分（basis=0，grow 等分全部空间）
let items = [box(0, { flex: "1" }), box(0, { flex: "1" }), box(0, { flex: "1" })];
layoutFlex(300, items);
print("场景1: flex:1 等分（容器 300，应各 100）", items);

// 场景 2：flex:auto 从基础宽再分剩余
items = [box(150, { flex: "auto" }), box(100, { flex: "auto" }), box(80, { flex: "auto" })];
layoutFlex(300, items);
print("场景2: flex:auto（basis=自身宽，剩余 300-330=-30 进入 shrink）", items);

// 场景 3：shrink 加权（basis 大的缩得多）
items = [box(150, { "flex-shrink": "1", "flex-basis": "150" }), box(100, { "flex-shrink": "1", "flex-basis": "100" }), box(80, { "flex-shrink": "1", "flex-basis": "80" })];
layoutFlex(300, items);
print("场景3: shrink 加权（basis 150/100/80，缩 30，大的多缩）", items);

// 场景 4：grow 不等比
items = [box(0, { flex: "1" }), box(0, { flex: "2" }), box(0, { flex: "1" })];
layoutFlex(400, items);
print("场景4: grow 1:2:1（容器 400，应 100/200/100）", items);

// 场景 5：justify-content: space-between
items = [box(60, {}), box(60, {}), box(60, {})];
layoutFlex(300, items, "space-between");
print("场景5: justify-content: space-between（各 60，剩余 120 分两段）", items);

console.log("\n✓ mini-flex-layout 验证完毕");
