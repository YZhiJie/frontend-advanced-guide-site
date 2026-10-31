/** 65-01-print-pagination.ts —— 打印分页计算器：按页高切块 + 表头重复 + 孤行控制 + mm↔px 换算 */

// 单位换算：CSS 打印用物理单位,mm 是唯一可信的（96px = 25.4mm 是规范定值）
const MM_PER_PX = 25.4 / 96;
function pxToMm(px: number): number {
  return px * MM_PER_PX;
}
function mmToPx(mm: number): number {
  return mm / MM_PER_PX;
}

// 页面模型：A4 = 210×297mm;可用高 = 页高 - 上下边距
interface PageSpec {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
}
const A4: PageSpec = { widthMm: 210, heightMm: 297, marginTopMm: 15, marginBottomMm: 15 };
function usableHeightPx(p: PageSpec): number {
  return mmToPx(p.heightMm - p.marginTopMm - p.marginBottomMm);
}

// 分页切块：把内容块按可用页高装箱
interface Block {
  id: string;
  heightPx: number;
  keepWithNext?: boolean; // 与下一块同页（标题不与首行表格分离）
  unbreakable?: boolean; // 不可跨页拆分（图片/小卡片）
}
interface Page {
  blocks: Block[];
  usedPx: number;
}
function paginate(blocks: Block[], spec: PageSpec, repeatHeader?: Block): Page[] {
  const limit = usableHeightPx(spec);
  const headerH = repeatHeader?.heightPx ?? 0;
  const pages: Page[] = [];
  let cur: Page = { blocks: [], usedPx: 0 };

  const pageLimit = () => limit - (pages.length > 0 || cur.blocks.length > 0 ? 0 : 0);
  // 首页也要重复表头时把 headerH 计入；本例表头从第 2 页起重复
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const effectiveLimit = pageLimit() - (pages.length > 0 ? headerH : 0);
    // 孤行控制：keepWithNext 的块如果"放得下自己但放不下下一块",提前换页
    const next = blocks[i + 1];
    const needPair = b.keepWithNext && next ? b.heightPx + next.heightPx : b.heightPx;
    if (b.unbreakable && b.heightPx > limit) {
      // 超高不可拆分块：独占一页并告警（真实场景应缩放）
      if (cur.blocks.length) {
        pages.push(cur);
        cur = { blocks: [], usedPx: 0 };
      }
      pages.push({ blocks: [b], usedPx: b.heightPx });
      continue;
    }
    if (cur.usedPx + needPair > effectiveLimit && cur.blocks.length > 0) {
      pages.push(cur);
      cur = { blocks: [], usedPx: 0 };
    }
    cur.blocks.push(b);
    cur.usedPx += b.heightPx;
  }
  if (cur.blocks.length) pages.push(cur);
  return pages;
}

// ---- 断言 ----
console.assert(Math.abs(pxToMm(96) - 25.4) < 1e-9, "96px === 25.4mm 规范定值");
console.assert(Math.abs(pxToMm(mmToPx(297)) - 297) < 1e-9, "换算互逆");
const usable = usableHeightPx(A4); // (297-30)mm ≈ 1007px
console.assert(Math.abs(usable - mmToPx(267)) < 0.01, "A4 可用高 = 297-30mm");

// 装箱：每页上限 100px 的简化场景
const spec100: PageSpec = { widthMm: 210, heightMm: 100 * MM_PER_PX + 0, marginTopMm: 0, marginBottomMm: 0 };
// usableHeightPx(spec100) === 100px
const pages = paginate(
  [
    { id: "a", heightPx: 40 },
    { id: "b", heightPx: 40 },
    { id: "c", heightPx: 40 }, // c 触发换页
  ],
  spec100,
);
console.assert(pages.length === 2 && pages[0].blocks.map((b) => b.id).join() === "a,b", "放不下即换页");

// 孤行控制：标题 keepWithNext,放得下标题但放不下首行 → 标题提前换页
const pages2 = paginate(
  [
    { id: "filler", heightPx: 60 },
    { id: "title", heightPx: 30, keepWithNext: true },
    { id: "row1", heightPx: 30 },
  ],
  spec100,
);
console.assert(
  pages2[0].blocks.map((b) => b.id).join() === "filler" &&
    pages2[1].blocks.map((b) => b.id).join() === "title,row1",
  "keepWithNext：标题不与内容分离",
);

// 不可拆分块独占一页
const pages3 = paginate(
  [
    { id: "x", heightPx: 90 },
    { id: "big-img", heightPx: 300, unbreakable: true },
  ],
  spec100,
);
console.assert(
  pages3.length === 2 && pages3[1].blocks[0].id === "big-img",
  "超高 unbreakable 独占一页",
);

console.log("✅ 单位换算 / 装箱分页 / 孤行控制 / 独占页全部通过");
