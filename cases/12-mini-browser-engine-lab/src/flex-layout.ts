// 文件: cases/12-mini-browser-engine-lab/src/flex-layout.ts
// flex-layout.ts
// Flex 布局实现
// 支持：flex-direction(row/row-reverse/column/column-reverse) / flex-wrap / justify-content / align-items / align-self / flex-grow / flex-shrink / flex-basis / order

import type { Box } from "./box-model.js";
import { parseCssValue } from "./box-model.js";
import type { FinalStyleMap } from "./cascade.js";

// ---------------------------------------------------------------------------
// Flex 容器属性
// ---------------------------------------------------------------------------

export interface FlexContainerProps {
  direction: "row" | "row-reverse" | "column" | "column-reverse";
  wrap: "nowrap" | "wrap" | "wrap-reverse";
  justifyContent:
    | "flex-start"
    | "flex-end"
    | "center"
    | "space-between"
    | "space-around"
    | "space-evenly";
  alignItems: "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
  alignContent:
    | "flex-start"
    | "flex-end"
    | "center"
    | "stretch"
    | "space-between"
    | "space-around";
  gapMain: number; // 主轴 gap
  gapCross: number; // 交叉轴 gap
}

export interface FlexItemProps {
  order: number;
  flexGrow: number;
  flexShrink: number;
  flexBasis: number | "auto"; // auto = 使用 width/height
  alignSelf?: FlexContainerProps["alignItems"];
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

export function getContainerProps(box: Box): FlexContainerProps {
  const p = (prop: string) => box.style.properties.get(prop)?.value;

  const direction = (p("flex-direction") ??
    "row") as FlexContainerProps["direction"];
  const wrap = (p("flex-wrap") ?? "nowrap") as FlexContainerProps["wrap"];
  const jc = (p("justify-content") ??
    "flex-start") as FlexContainerProps["justifyContent"];
  const ai = (p("align-items") ??
    "stretch") as FlexContainerProps["alignItems"];
  const ac = (p("align-content") ??
    "stretch") as FlexContainerProps["alignContent"];

  const gapStr = p("gap") ?? p("row-gap") ?? p("column-gap");
  let gapMain = 0,
    gapCross = 0;
  if (gapStr) {
    const tokens = gapStr.trim().split(/\s+/);
    const first = parseCssValue(tokens[0]);
    gapMain = first?.value ?? 0;
    const second = tokens[1] ? parseCssValue(tokens[1]) : undefined;
    gapCross = second?.value ?? first?.value ?? 0;
  }
  // column 时 main/cross 互换
  if (direction === "column" || direction === "column-reverse") {
    [gapMain, gapCross] = [gapCross, gapMain];
  }

  return {
    direction,
    wrap,
    justifyContent: jc,
    alignItems: ai,
    alignContent: ac,
    gapMain,
    gapCross,
  };
}

export function getItemProps(
  item: Box,
  containerDir?: FlexContainerProps["direction"],
): FlexItemProps {
  const p = (prop: string) => item.style.properties.get(prop)?.value;

  const order = parseInt(p("order") ?? "0", 10) || 0;

  // flex 简写: flex: grow shrink basis
  let grow = 0,
    shrink = 1;
  let basisRaw: string | undefined = undefined;
  const flexShort = p("flex");
  if (flexShort) {
    const tokens = flexShort.trim().split(/\s+/);
    if (tokens.length === 1) {
      if (tokens[0] === "auto") {
        grow = 1;
        shrink = 1;
        basisRaw = "auto";
      } else if (tokens[0] === "none") {
        grow = 0;
        shrink = 0;
        basisRaw = "auto";
      } else {
        grow = parseFloat(tokens[0]) || 0;
      }
    } else if (tokens.length === 2) {
      grow = parseFloat(tokens[0]) || 0;
      const t1 = tokens[1].toLowerCase();
      if (t1 === "auto" || t1 === "content") basisRaw = t1;
      else shrink = parseFloat(tokens[1]) || 0;
    } else {
      grow = parseFloat(tokens[0]) || 0;
      shrink = parseFloat(tokens[1]) || 0;
      basisRaw = tokens[2];
    }
  } else {
    grow = parseFloat(p("flex-grow") ?? "0") || 0;
    shrink = parseFloat(p("flex-shrink") ?? "1") || 1;
    basisRaw = p("flex-basis");
  }

  let flexBasis: number | "auto" = "auto";
  if (basisRaw !== undefined && basisRaw !== "auto") {
    const b = parseCssValue(basisRaw);
    if (b) {
      if (b.unit === "auto") flexBasis = "auto";
      else flexBasis = b.value;
    }
  }

  const alignSelfRaw = p("align-self");
  const alignSelf =
    alignSelfRaw && alignSelfRaw !== "auto"
      ? (alignSelfRaw as FlexItemProps["alignSelf"])
      : undefined;

  return {
    order,
    flexGrow: grow,
    flexShrink: shrink,
    flexBasis,
    alignSelf,
    marginLeft: item.marginLeft,
    marginRight: item.marginRight,
    marginTop: item.marginTop,
    marginBottom: item.marginBottom,
  };
}

// ---------------------------------------------------------------------------
// 主轴 / 交叉轴辅助
// ---------------------------------------------------------------------------

function isMainHorizontal(dir: FlexContainerProps["direction"]): boolean {
  return dir === "row" || dir === "row-reverse";
}

function mainStart(container: Box): number {
  // 主轴起点（内容区起点）
  return isMainHorizontal(getContainerProps(container).direction)
    ? container.borderLeft + container.paddingLeft
    : container.borderTop + container.paddingTop;
}

function crossStart(container: Box): number {
  return isMainHorizontal(getContainerProps(container).direction)
    ? container.borderTop + container.paddingTop
    : container.borderLeft + container.paddingLeft;
}

function mainSize(container: Box): number {
  // 主轴内容尺寸
  const dir = getContainerProps(container).direction;
  return isMainHorizontal(dir)
    ? Math.max(0, container.width)
    : Math.max(0, container.height);
}

function crossSize(container: Box): number {
  const dir = getContainerProps(container).direction;
  return isMainHorizontal(dir)
    ? Math.max(0, container.height)
    : Math.max(0, container.width);
}

function itemMainSize(
  item: Box,
  props: FlexItemProps,
  containerDir: FlexContainerProps["direction"],
): number {
  if (props.flexBasis !== "auto") return props.flexBasis;
  return isMainHorizontal(containerDir) ? item.width : item.height;
}

function itemCrossSize(
  item: Box,
  containerDir: FlexContainerProps["direction"],
): number {
  return isMainHorizontal(containerDir) ? item.height : item.width;
}

function setMainSize(
  item: Box,
  size: number,
  containerDir: FlexContainerProps["direction"],
): void {
  if (isMainHorizontal(containerDir)) item.width = size;
  else item.height = size;
  item.borderWidth =
    item.width +
    item.paddingLeft +
    item.paddingRight +
    item.borderLeft +
    item.borderRight;
  item.borderHeight =
    item.height +
    item.paddingTop +
    item.paddingBottom +
    item.borderTop +
    item.borderBottom;
  item.marginBoxWidth = item.borderWidth + item.marginLeft + item.marginRight;
  item.marginBoxHeight = item.borderHeight + item.marginTop + item.marginBottom;
}

function setCrossSize(
  item: Box,
  size: number,
  containerDir: FlexContainerProps["direction"],
): void {
  if (isMainHorizontal(containerDir)) item.height = size;
  else item.width = size;
  item.borderWidth =
    item.width +
    item.paddingLeft +
    item.paddingRight +
    item.borderLeft +
    item.borderRight;
  item.borderHeight =
    item.height +
    item.paddingTop +
    item.paddingBottom +
    item.borderTop +
    item.borderBottom;
  item.marginBoxWidth = item.borderWidth + item.marginLeft + item.marginRight;
  item.marginBoxHeight = item.borderHeight + item.marginTop + item.marginBottom;
}

function mainMargin(
  props: FlexItemProps,
  containerDir: FlexContainerProps["direction"],
): number {
  if (isMainHorizontal(containerDir))
    return props.marginLeft + props.marginRight;
  return props.marginTop + props.marginBottom;
}

function crossMargin(
  props: FlexItemProps,
  containerDir: FlexContainerProps["direction"],
): number {
  if (isMainHorizontal(containerDir))
    return props.marginTop + props.marginBottom;
  return props.marginLeft + props.marginRight;
}

// ---------------------------------------------------------------------------
// 行（line）划分（wrap）
// ---------------------------------------------------------------------------

interface FlexLine {
  items: { box: Box; props: FlexItemProps; baseMain: number }[];
  usedMain: number; // 已占主轴（不含 gap 和 margin）
  crossSize: number; // 本行交叉轴尺寸（用 items 里最大的交叉尺寸）
}

function buildLines(
  container: Box,
  items: Box[],
  props: FlexContainerProps,
): FlexLine[] {
  const lines: FlexLine[] = [];
  const sorted = [...items].sort((a, b) => {
    const oa = getItemProps(a, props.direction).order;
    const ob = getItemProps(b, props.direction).order;
    return oa - ob;
  });

  if (props.wrap === "nowrap") {
    // 所有一行
    const line: FlexLine = { items: [], usedMain: 0, crossSize: 0 };
    for (const item of sorted) {
      const ip = getItemProps(item, props.direction);
      const base = itemMainSize(item, ip, props.direction);
      line.items.push({ box: item, props: ip, baseMain: base });
      line.usedMain += base + mainMargin(ip, props.direction);
      const cross =
        itemCrossSize(item, props.direction) + crossMargin(ip, props.direction);
      if (cross > line.crossSize) line.crossSize = cross;
    }
    line.usedMain += props.gapMain * Math.max(0, line.items.length - 1);
    lines.push(line);
    return lines;
  }

  const availMain = mainSize(container);
  let cur: FlexLine | null = null;

  for (const item of sorted) {
    const ip = getItemProps(item, props.direction);
    const base = itemMainSize(item, ip, props.direction);
    const cross =
      itemCrossSize(item, props.direction) + crossMargin(ip, props.direction);
    const mainMargin_ = mainMargin(ip, props.direction);

    const itemMain = base + mainMargin_;
    const itemCost =
      cur && cur.items.length > 0 ? itemMain + props.gapMain : itemMain;

    if (cur && cur.usedMain + itemCost <= availMain) {
      cur.items.push({ box: item, props: ip, baseMain: base });
      cur.usedMain += itemCost;
      if (cross > cur.crossSize) cur.crossSize = cross;
    } else {
      if (cur) lines.push(cur);
      cur = {
        items: [{ box: item, props: ip, baseMain: base }],
        usedMain: itemMain,
        crossSize: cross,
      };
    }
  }
  if (cur) lines.push(cur);

  return lines;
}

// ---------------------------------------------------------------------------
// 主轴空间分配（flex-grow / flex-shrink）
// ---------------------------------------------------------------------------

function distributeMain(
  line: FlexLine,
  props: FlexContainerProps,
  availMain: number,
): void {
  let totalBasis = 0;
  let totalGrow = 0;
  let totalShrink = 0;

  for (const entry of line.items) {
    totalBasis += entry.baseMain;
    if (entry.props.flexGrow > 0) totalGrow += entry.props.flexGrow;
    if (entry.props.flexShrink > 0) totalShrink += entry.props.flexShrink;
  }

  const gapTotal = props.gapMain * Math.max(0, line.items.length - 1);
  const totalMargin = line.items.reduce(
    (s, e) => s + mainMargin(e.props, props.direction),
    0,
  );
  const free = availMain - gapTotal - totalMargin - totalBasis;

  if (free >= 0 && totalGrow > 0) {
    // grow
    let distributed = 0;
    for (const entry of line.items) {
      if (entry.props.flexGrow > 0) {
        const delta = (free * entry.props.flexGrow) / totalGrow;
        distributed += delta;
        setMainSize(entry.box, entry.baseMain + delta, props.direction);
      } else {
        setMainSize(entry.box, entry.baseMain, props.direction);
      }
    }
  } else if (free < 0 && totalShrink > 0) {
    // shrink
    const deficit = -free;
    let weightedTotal = 0;
    for (const entry of line.items) {
      weightedTotal +=
        entry.baseMain *
        (entry.props.flexShrink > 0 ? entry.props.flexShrink : 0);
    }
    // 每个 item 按 basis * shrink / weightedTotal 分担 deficit
    for (const entry of line.items) {
      if (entry.props.flexShrink > 0 && weightedTotal > 0) {
        const share =
          (deficit * entry.baseMain * entry.props.flexShrink) / weightedTotal;
        const newMain = Math.max(0, entry.baseMain - share);
        setMainSize(entry.box, newMain, props.direction);
      } else {
        setMainSize(entry.box, entry.baseMain, props.direction);
      }
    }
  } else {
    // 直接用 basis
    for (const entry of line.items) {
      setMainSize(entry.box, entry.baseMain, props.direction);
    }
  }

  // 重新计算 line 的 usedMain（用于 justify-content）
  let used = 0;
  for (const entry of line.items) {
    used += isMainHorizontal(props.direction)
      ? entry.box.width
      : entry.box.height;
    used += mainMargin(entry.props, props.direction);
  }
  line.usedMain = used + gapTotal;
}

// ---------------------------------------------------------------------------
// justify-content 定位主轴
// ---------------------------------------------------------------------------

function positionMain(
  lines: FlexLine[],
  props: FlexContainerProps,
  container: Box,
): void {
  const availMain = mainSize(container);
  const isHoriz = isMainHorizontal(props.direction);
  const reverse =
    props.direction === "row-reverse" || props.direction === "column-reverse";

  for (const line of lines) {
    const lineUsed = line.usedMain;
    const free = availMain - lineUsed;

    let start = 0;
    let step = props.gapMain;

    switch (props.justifyContent) {
      case "flex-start":
        start = 0;
        break;
      case "flex-end":
        start = free;
        break;
      case "center":
        start = free / 2;
        break;
      case "space-between":
        start = 0;
        step = free / Math.max(1, line.items.length - 1) + props.gapMain;
        break;
      case "space-around": {
        const edge = free / (2 * line.items.length);
        start = edge;
        step = free / line.items.length + props.gapMain;
        break;
      }
      case "space-evenly": {
        const part = free / (line.items.length + 1);
        start = part;
        step = part + props.gapMain;
        break;
      }
    }

    let cursor = start;
    for (const entry of line.items) {
      const mainLen = isHoriz ? entry.box.width : entry.box.height;
      const marginStart = isHoriz
        ? entry.props.marginLeft
        : entry.props.marginTop;
      const marginEnd = isHoriz
        ? entry.props.marginRight
        : entry.props.marginBottom;
      const inset = cursor + marginStart;
      const base = mainStart(container);

      if (isHoriz) {
        entry.box.x = base + inset;
      } else {
        entry.box.y = base + inset;
      }

      cursor += mainLen + marginStart + marginEnd;
      // 每轮后加 step（包含 gap 或 justifyContent 的间隔）
      // flex-start/end/center 的 step = props.gapMain；其他模式的 step 已在 switch 中计算好
      cursor += step;
    }

    if (reverse) {
      // 把主轴方向翻转：用 mainSize 减去已设置的位置和长度
      const startEdge = mainStart(container) + mainSize(container);
      for (const entry of line.items) {
        const mainLen = isHoriz ? entry.box.width : entry.box.height;
        if (isHoriz) {
          entry.box.x =
            startEdge -
            (entry.box.x - mainStart(container) + mainLen) -
            mainStart(container) +
            mainStart(container);
          // 上面太绕，简化：entry.box.x 是相对 padding box 的距离，重新算
        }
      }
      // 更简单：重新从右向左算
      cursor =
        availMain - lineUsed + (props.justifyContent === "flex-start" ? 0 : 0);
      // 其实 reverse 就把每个 item 的 x/y 翻转一下
      for (const entry of line.items) {
        const mainLen = isHoriz ? entry.box.width : entry.box.height;
        const pos = isHoriz
          ? entry.box.x - mainStart(container)
          : entry.box.y - mainStart(container);
        const reversedPos = availMain - pos - mainLen;
        if (isHoriz) entry.box.x = mainStart(container) + reversedPos;
        else entry.box.y = mainStart(container) + reversedPos;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 交叉轴对齐：align-items / align-self / align-content
// ---------------------------------------------------------------------------

function positionCross(
  lines: FlexLine[],
  props: FlexContainerProps,
  container: Box,
): void {
  const availCross = crossSize(container);
  const isHoriz = isMainHorizontal(props.direction);
  const crossStartPos = crossStart(container);

  // 先决定每行在交叉轴的起始位置（align-content）
  const totalLineCross =
    lines.reduce((s, l) => s + l.crossSize, 0) +
    props.gapCross * Math.max(0, lines.length - 1);
  let lineCursor = 0;
  switch (props.alignContent) {
    case "flex-start":
      lineCursor = 0;
      break;
    case "flex-end":
      lineCursor = availCross - totalLineCross;
      break;
    case "center":
      lineCursor = (availCross - totalLineCross) / 2;
      break;
    case "space-between": {
      lineCursor = 0;
      break;
    }
    case "space-around": {
      const edge = (availCross - totalLineCross) / (2 * lines.length);
      lineCursor = edge;
      break;
    }
    case "stretch":
      lineCursor = 0;
      break;
  }

  const lineGapBase = (() => {
    const used = availCross - totalLineCross;
    if (props.alignContent === "space-between" && lines.length > 1)
      return used / (lines.length - 1);
    if (props.alignContent === "space-around") return used / lines.length;
    return props.gapCross;
  })();

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    // align-content: stretch 时每行高度铺满剩余空间
    let lineCrossSize = line.crossSize;
    if (props.alignContent === "stretch") {
      const stretched =
        (availCross - props.gapCross * Math.max(0, lines.length - 1)) /
        lines.length;
      lineCrossSize = Math.max(lineCrossSize, stretched);
    }

    for (const entry of line.items) {
      const align = entry.props.alignSelf ?? props.alignItems;

      let itemCrossLen = itemCrossSize(entry.box, props.direction);
      const marginCStart = isHoriz
        ? entry.props.marginTop
        : entry.props.marginLeft;
      const marginCEnd = isHoriz
        ? entry.props.marginBottom
        : entry.props.marginRight;

      let inset = 0;
      switch (align) {
        case "flex-start":
          inset = lineCursor + marginCStart;
          break;
        case "flex-end":
          inset = lineCursor + lineCrossSize - itemCrossLen - marginCEnd;
          break;
        case "center":
          inset = lineCursor + (lineCrossSize - itemCrossLen) / 2;
          break;
        case "stretch": {
          inset = lineCursor + marginCStart;
          const free = lineCrossSize - marginCStart - marginCEnd;
          if (itemCrossLen === 0 || true) {
            setCrossSize(entry.box, Math.max(0, free), props.direction);
            itemCrossLen = itemCrossSize(entry.box, props.direction);
          }
          break;
        }
        case "baseline":
          inset = lineCursor + marginCStart;
          break;
      }

      if (isHoriz) entry.box.y = crossStartPos + inset;
      else entry.box.x = crossStartPos + inset;
    }

    lineCursor += lineCrossSize + lineGapBase;
  }
}

// ---------------------------------------------------------------------------
// layoutFlex 主入口
// ---------------------------------------------------------------------------

export function layoutFlex(container: Box): void {
  const props = getContainerProps(container);
  const lines = buildLines(container, container.children, props);

  for (const line of lines) {
    distributeMain(line, props, mainSize(container));
  }

  positionMain(lines, props, container);
  positionCross(lines, props, container);

  // 递归
  for (const child of container.children) {
    const childProps = getContainerProps(child);
    const pFlex = child.style.properties.get("display")?.value.toLowerCase();
    if (pFlex === "flex" || pFlex === "inline-flex") {
      layoutFlex(child);
    }
  }
}
