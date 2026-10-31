// 文件: examples/28-05-box-model.ts
// ============ 盒模型计算 ============
// content-box：width 即内容宽；border-box：width 含 padding+border，内容宽 = width - padding - border。
// 简写 padding/margin：1/2/3/4 值顺时针展开。百分比基于父宽。

export type CssUnit = "px" | "%" | "auto";
export interface CssValue { value: number; unit: CssUnit; }

export function parseCssValue(raw: string | undefined): CssValue | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toLowerCase();
  if (t === "auto" || t === "") return { value: 0, unit: "auto" };
  if (t === "0") return { value: 0, unit: "px" };
  const m = t.match(/^([+-]?\d*\.?\d+)(px|%)?$/);
  if (!m) return undefined;
  return { value: parseFloat(m[1]), unit: (m[2] ?? "px") as CssUnit };
}

// 四方向简写：1→四边, 2→上下/左右, 3→上/左右/下, 4→上右下左
export function parseShorthand(raw: string | undefined): (CssValue | undefined)[] {
  if (!raw) return [undefined, undefined, undefined, undefined];
  const v = raw.trim().split(/\s+/).map(parseCssValue);
  if (v.length === 1) return [v[0], v[0], v[0], v[0]];
  if (v.length === 2) return [v[0], v[1], v[0], v[1]];
  if (v.length === 3) return [v[0], v[1], v[2], v[1]];
  return [v[0], v[1], v[2], v[3]];
}

export interface Box {
  width: number; height: number;
  paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number;
  borderTop: number; borderRight: number; borderBottom: number; borderLeft: number;
  marginTop: number; marginRight: number; marginBottom: number; marginLeft: number;
  boxSizing: "content-box" | "border-box";
  borderWidth: number; borderHeight: number;
  marginBoxWidth: number; marginBoxHeight: number;
}

export function computeBox(style: Map<string, string>, parentWidth = 0): Box {
  const p = (k: string) => style.get(k);
  const boxSizing = (p("box-sizing") as Box["boxSizing"]) ?? "content-box";
  const [pt, pr, pb, pl] = parseShorthand(p("padding"));
  const [mt, mr, mb, ml] = parseShorthand(p("margin"));
  const [bt, br, bb, bl] = parseShorthand(p("border-width"));

  const resolve = (v: CssValue | undefined, parent: number, fb = 0) => {
    if (!v) return fb;
    if (v.unit === "%") return (v.value / 100) * parent;
    if (v.unit === "auto") return fb;
    return v.value;
  };

  const paddingTop = resolve(pt, parentWidth);
  const paddingRight = resolve(pr, parentWidth);
  const paddingBottom = resolve(pb, parentWidth);
  const paddingLeft = resolve(pl, parentWidth);
  const borderTop = resolve(bt, parentWidth);
  const borderRight = resolve(br, parentWidth);
  const borderBottom = resolve(bb, parentWidth);
  const borderLeft = resolve(bl, parentWidth);
  const marginTop = resolve(mt, parentWidth);
  const marginRight = resolve(mr, parentWidth);
  const marginBottom = resolve(mb, parentWidth);
  const marginLeft = resolve(ml, parentWidth);

  const wRaw = parseCssValue(p("width"));
  const hRaw = parseCssValue(p("height"));
  let width = 0, height = 0;
  if (wRaw && wRaw.unit !== "auto") {
    width = wRaw.unit === "%" ? (wRaw.value / 100) * parentWidth : wRaw.value;
    if (boxSizing === "border-box") width = Math.max(0, width - borderLeft - borderRight - paddingLeft - paddingRight);
  }
  if (hRaw && hRaw.unit !== "auto") {
    height = hRaw.unit === "%" ? (hRaw.value / 100) * 0 : hRaw.value;
    if (boxSizing === "border-box") height = Math.max(0, height - borderTop - borderBottom - paddingTop - paddingBottom);
  }

  const borderWidth = width + paddingLeft + paddingRight + borderLeft + borderRight;
  const borderHeight = height + paddingTop + paddingBottom + borderTop + borderBottom;
  return {
    width, height, paddingTop, paddingRight, paddingBottom, paddingLeft,
    borderTop, borderRight, borderBottom, borderLeft,
    marginTop, marginRight, marginBottom, marginLeft, boxSizing,
    borderWidth, borderHeight,
    marginBoxWidth: borderWidth + marginLeft + marginRight,
    marginBoxHeight: borderHeight + marginTop + marginBottom,
  };
}

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

function show(label: string, b: Box) {
  console.log(`  ${label}`);
  console.log(`    content   : ${b.width} × ${b.height}`);
  console.log(`    border-box: ${b.borderWidth} × ${b.borderHeight}`);
  console.log(`    margin-box: ${b.marginBoxWidth} × ${b.marginBoxHeight}`);
}

console.log("=== 简写展开 ===");
console.log("  padding: 8px        →", parseShorthand("8px").map((v) => v?.value));
console.log("  padding: 4px 8px    →", parseShorthand("4px 8px").map((v) => v?.value));
console.log("  padding: 1 2 3      →", parseShorthand("1 2 3").map((v) => v?.value));
console.log("  padding: 1 2 3 4    →", parseShorthand("1 2 3 4").map((v) => v?.value));

console.log("\n=== content-box vs border-box ===");
const s1 = new Map(Object.entries({ width: "100px", padding: "10px", "border-width": "2px", "box-sizing": "content-box" }));
show("content-box: width=100 padding=10 border=2", computeBox(s1));

const s2 = new Map(Object.entries({ width: "100px", padding: "10px", "border-width": "2px", "box-sizing": "border-box" }));
show("border-box : width=100 padding=10 border=2", computeBox(s2));

console.log("\n=== 百分比基于父宽 ===");
const s3 = new Map(Object.entries({ width: "50%", padding: "5%" }));
show("父宽 400，width:50% padding:5%", computeBox(s3, 400));

console.log("\n✓ mini-box-model 验证完毕");
