// 文件: examples/41-01-screen-fit.ts
// ============ 大屏适配：等比缩放方案 ============
// 大屏设计稿通常是 1920×1080，但投屏设备分辨率五花八门。
// 主流方案是 transform: scale 等比缩放：内容按 1920×1080 排版，整体缩放贴合实际屏幕。
// 两种留白策略：
// - contain（保持比例，多余部分留黑边）：不变形，适合汇报展示；
// - cover（保持比例，裁掉溢出部分）：铺满但有裁切，适合超宽拼接屏。
// 也有用 scale 分轴缩放（x/y 各算各的）强行铺满——图形会变形，慎用。

export interface DesignSize {
  width: number; // 设计稿宽（如 1920）
  height: number; // 设计稿高（如 1080）
}

export type FitMode = "contain" | "cover" | "stretch";

export interface FitResult {
  scaleX: number;
  scaleY: number;
  /** 容器居中所需偏移 */
  offsetX: number;
  offsetY: number;
  mode: FitMode;
  /** 两侧黑边宽度（contain 时）或裁切宽度（cover 时），便于调试 */
  blankX: number;
  blankY: number;
}

/** 计算 scale：screen 是实际屏幕尺寸，design 是设计稿尺寸 */
export function computeFit(
  screen: { width: number; height: number },
  design: DesignSize,
  mode: FitMode = "contain",
): FitResult {
  const rawX = screen.width / design.width;
  const rawY = screen.height / design.height;
  let scaleX: number;
  let scaleY: number;
  switch (mode) {
    case "contain":
      scaleX = scaleY = Math.min(rawX, rawY); // 取小：完整显示
      break;
    case "cover":
      scaleX = scaleY = Math.max(rawX, rawY); // 取大：铺满裁切
      break;
    case "stretch":
      scaleX = rawX;
      scaleY = rawY; // 分轴：铺满但变形
      break;
  }
  const scaledW = design.width * scaleX;
  const scaledH = design.height * scaleY;
  return {
    scaleX,
    scaleY,
    offsetX: (screen.width - scaledW) / 2,
    offsetY: (screen.height - scaledH) / 2,
    mode,
    blankX: Math.max(0, screen.width - scaledW) / 2,
    blankY: Math.max(0, screen.height - scaledH) / 2,
  };
}

/** 生成 transform 样式（scale 原点必须 left top，先平移后缩放，否则偏移计算全错） */
export function toTransformStyle(fit: FitResult): string {
  return `transform: translate(${fit.offsetX}px, ${fit.offsetY}px) scale(${fit.scaleX}, ${fit.scaleY}); transform-origin: left top;`;
}

/** 监听窗口变化：ResizeObserver + 防抖重算（大屏开机自动适应的关键） */
export function createAutoFit(
  design: DesignSize,
  apply: (fit: FitResult) => void,
  mode: FitMode = "contain",
): { resize(w: number, h: number): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    resize(w: number, h: number) {
      clearTimeout(timer); // 连续 resize 事件只算最后一次
      timer = setTimeout(
        () => apply(computeFit({ width: w, height: h }, design, mode)),
        100,
      );
    },
  };
}

// ---------------- 验证 ----------------

const design: DesignSize = { width: 1920, height: 1080 };

console.log("=== contain：2K 屏（2560×1440）正好 1.333 倍 ===");
const f1 = computeFit({ width: 2560, height: 1440 }, design);
console.log({
  scaleX: Number(f1.scaleX.toFixed(3)),
  blankX: f1.blankX,
  blankY: f1.blankY,
});

console.log("\n=== contain：带浏览器工具栏的 1920×950（高度不足） ===");
const f2 = computeFit({ width: 1920, height: 950 }, design);
console.log(
  "scale:",
  f2.scaleY.toFixed(3),
  "上下黑边:",
  f2.blankY.toFixed(1),
  "px",
);

console.log("\n=== cover：超宽拼接屏 3840×1080（左右裁切） ===");
const f3 = computeFit({ width: 3840, height: 1080 }, design, "cover");
console.log(
  "scale:",
  f3.scaleX.toFixed(3),
  "水平裁切合计:",
  f3.blankX * 2,
  "px（负偏移裁切）",
);

console.log("\n=== stretch：铺满但变形（慎用） ===");
const f4 = computeFit({ width: 3840, height: 1080 }, design, "stretch");
console.log(
  "scaleX:",
  f4.scaleX.toFixed(3),
  "scaleY:",
  f4.scaleY.toFixed(3),
  "→ 圆变椭圆",
);

console.log("\n=== 防抖重算 ===");
const fitter = createAutoFit(design, (fit) =>
  console.log("应用 scale:", fit.scaleX.toFixed(3)),
);
fitter.resize(2560, 1440);
fitter.resize(2560, 1400);
fitter.resize(2560, 1440); // 100ms 内连续三次 → 只应用最后一次

console.log("\n=== 样式输出 ===");
console.log(toTransformStyle(f1));
