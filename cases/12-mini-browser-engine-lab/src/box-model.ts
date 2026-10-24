// 文件: cases/12-mini-browser-engine-lab/src/box-model.ts
// box-model.ts
// 盒模型计算 + 尺寸解析
// 输入: 节点 + 最终样式 Map -> Box { width, height, padding, border, margin, boxSizing, children, x, y }

import type { FinalStyleMap } from './cascade.ts';
import type { DomNode } from './selector.ts';

// ---------------------------------------------------------------------------
// 值解析
// ---------------------------------------------------------------------------

export type CssUnit = 'px' | '%' | 'auto' | 'em' | 'rem' | 'vw' | 'vh';

export interface CssValue {
  kind: 'number';
  value: number;       // px 数
  raw: string;         // 原始 CSS 字符串（如 "12px" / "50%" / "auto"）
  unit: CssUnit;
}

export function parseCssValue(raw: string | undefined): CssValue | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'auto' || trimmed === '') return { kind: 'number', value: 0, raw: trimmed, unit: 'auto' };
  if (trimmed === '0') return { kind: 'number', value: 0, raw: trimmed, unit: 'px' };

  const m = trimmed.match(/^([+-]?\d*\.?\d+)(px|%|em|rem|vw|vh)?$/);
  if (!m) return undefined;
  const num = parseFloat(m[1]);
  const unit = (m[2] ?? 'px') as CssUnit;
  return { kind: 'number', value: num, raw: trimmed, unit };
}

// 解析四方向属性（margin/padding），支持 1-4 个值
export function parseShorthand(raw: string | undefined): [CssValue | undefined, CssValue | undefined, CssValue | undefined, CssValue | undefined] {
  if (!raw) return [undefined, undefined, undefined, undefined];
  const tokens = raw.trim().split(/\s+/);
  const parsed = tokens.map(t => parseCssValue(t));
  const v = (n: number) => parsed[n];
  if (parsed.length === 1) {
    return [v(0), v(0), v(0), v(0)];
  }
  if (parsed.length === 2) {
    return [v(0), v(1), v(0), v(1)];
  }
  if (parsed.length === 3) {
    return [v(0), v(1), v(2), v(1)];
  }
  return [v(0), v(1), v(2), v(3)];
}

// ---------------------------------------------------------------------------
// Box 结构
// ---------------------------------------------------------------------------

export interface Box {
  node: DomNode;
  // 内容尺寸
  width: number;
  height: number;
  // 填充
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  // 边框（这里简化只取宽度）
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  borderLeft: number;
  // 外边距
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  boxSizing: 'content-box' | 'border-box';
  // 布局后填入的位置
  x: number;
  y: number;
  // 绝对 border-box 尺寸
  borderWidth: number;
  borderHeight: number;
  marginBoxWidth: number;
  marginBoxHeight: number;
  // 子节点
  children: Box[];
  // 引用原始样式（flex 需要再读）
  style: FinalStyleMap;
}

export interface LayoutContext {
  // 可用视口宽高（用于 % 换算）
  viewportWidth: number;
  viewportHeight: number;
  // 父 box 宽度（用于 % 换算）
  parentWidth: number;
  parentHeight: number;
}

// ---------------------------------------------------------------------------
// computeBox：根据 node + style 生成 Box
// ---------------------------------------------------------------------------

export function computeBox(
  node: DomNode,
  style: FinalStyleMap,
  ctx: LayoutContext,
  children?: Box[],
): Box {
  const p = (prop: string) => style.properties.get(prop)?.value;

  const boxSizing = (p('box-sizing') as 'content-box' | 'border-box') ?? 'content-box';

  const [pt, pr, pb, pl] = parseShorthand(p('padding'));
  const [mt, mr, mb, ml] = parseShorthand(p('margin'));
  // border 简化——只取 border-width
  const [bt, br, bb, bl] = parseShorthand(p('border-width'));

  const resolveLen = (v: CssValue | undefined, parent: number, fallback = 0): number => {
    if (!v) return fallback;
    if (v.unit === '%') return (v.value / 100) * parent;
    if (v.unit === 'auto') return fallback;
    return v.value;
  };

  const paddingTop = resolveLen(pt, ctx.parentWidth);
  const paddingRight = resolveLen(pr, ctx.parentWidth);
  const paddingBottom = resolveLen(pb, ctx.parentWidth);
  const paddingLeft = resolveLen(pl, ctx.parentWidth);

  const borderTop = resolveLen(bt, ctx.parentWidth);
  const borderRight = resolveLen(br, ctx.parentWidth);
  const borderBottom = resolveLen(bb, ctx.parentWidth);
  const borderLeft = resolveLen(bl, ctx.parentWidth);

  const marginTop = resolveLen(mt, ctx.parentWidth);
  const marginRight = resolveLen(mr, ctx.parentWidth);
  const marginBottom = resolveLen(mb, ctx.parentWidth);
  const marginLeft = resolveLen(ml, ctx.parentWidth);

  // width / height
  const widthRaw = parseCssValue(p('width'));
  const heightRaw = parseCssValue(p('height'));

  let width: number | 'auto' = 'auto';
  let height: number | 'auto' = 'auto';

  if (widthRaw && widthRaw.unit !== 'auto') {
    if (widthRaw.unit === '%') {
      width = (widthRaw.value / 100) * ctx.parentWidth;
    } else {
      width = widthRaw.value;
    }
    if (boxSizing === 'border-box') {
      width = width - borderLeft - borderRight - paddingLeft - paddingRight;
    }
    if (width < 0) width = 0;
  }
  if (heightRaw && heightRaw.unit !== 'auto') {
    if (heightRaw.unit === '%') {
      height = (heightRaw.value / 100) * ctx.parentHeight;
    } else {
      height = heightRaw.value;
    }
    if (boxSizing === 'border-box') {
      height = height - borderTop - borderBottom - paddingTop - paddingBottom;
    }
    if (height < 0) height = 0;
  }

  const w = typeof width === 'number' ? width : 0;
  const h = typeof height === 'number' ? height : 0;

  const box: Box = {
    node,
    width: w,
    height: h,
    paddingTop, paddingRight, paddingBottom, paddingLeft,
    borderTop, borderRight, borderBottom, borderLeft,
    marginTop, marginRight, marginBottom, marginLeft,
    boxSizing,
    x: 0,
    y: 0,
    borderWidth: w + paddingLeft + paddingRight + borderLeft + borderRight,
    borderHeight: h + paddingTop + paddingBottom + borderTop + borderBottom,
    marginBoxWidth: w + paddingLeft + paddingRight + borderLeft + borderRight + marginLeft + marginRight,
    marginBoxHeight: h + paddingTop + paddingBottom + borderTop + borderBottom + marginTop + marginBottom,
    children: children ?? [],
    style,
  };

  return box;
}

// 递归 computeBox 树
export function computeBoxTree(
  root: DomNode,
  styleResolver: (node: DomNode) => FinalStyleMap,
  ctx: LayoutContext,
): Box {
  const style = styleResolver(root);
  // 先构建 children box
  const kids: Box[] = [];
  if (root.children) {
    for (const c of root.children) {
      const childCtx: LayoutContext = {
        viewportWidth: ctx.viewportWidth,
        viewportHeight: ctx.viewportHeight,
        parentWidth: ctx.parentWidth,  // 暂时未知，layout 时再覆盖
        parentHeight: ctx.parentHeight,
      };
      kids.push(computeBoxTree(c, styleResolver, childCtx));
    }
  }
  return computeBox(root, style, ctx, kids);
}

// 简易 block 流式布局（给 flex 外的场景）
export function layoutFlow(root: Box, parentX = 0, parentY = 0): void {
  let curY = parentY;
  for (const child of root.children) {
    child.x = parentX + root.paddingLeft + root.borderLeft;
    child.y = curY + root.paddingTop + root.borderTop;
    curY += child.marginBoxHeight;
    layoutFlow(child, child.x, child.y);
  }
}
