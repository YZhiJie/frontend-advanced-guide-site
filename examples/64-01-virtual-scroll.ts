/** 64-01-virtual-scroll.ts —— 虚拟滚动内核：固定行高窗口计算 + 动态行高前缀和 + 滚动锚定 */

// --- 固定行高：O(1) 窗口计算 ---
interface Window {
  start: number; // 首个渲染行（含 overscan）
  end: number; // 末尾渲染行（不含）
  offsetTop: number; // 占位上偏移
  totalHeight: number; // 总高（撑起滚动条）
}
function windowFixed(opts: {
  scrollTop: number;
  viewportH: number;
  rowH: number;
  total: number;
  overscan?: number; // 视口外多渲染的行数,防快速滚动白屏
}): Window {
  const { scrollTop, viewportH, rowH, total, overscan = 3 } = opts;
  const firstVisible = Math.floor(scrollTop / rowH);
  const visibleCount = Math.ceil(viewportH / rowH);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(total, firstVisible + visibleCount + overscan);
  return {
    start,
    end,
    offsetTop: start * rowH,
    totalHeight: total * rowH,
  };
}

// --- 动态行高：前缀和 + 二分定位 ---
// 场景：行高不等（展开行/自适应文本）。offsets[i] = 第 i 行顶部偏移（前缀和）
class DynamicHeightIndex {
  private offsets: number[]; // 前缀和数组
  private heights: number[];
  constructor(heights: number[]) {
    this.heights = [...heights];
    this.offsets = [0];
    for (const h of heights) this.offsets.push(this.offsets[this.offsets.length - 1] + h);
  }
  totalHeight(): number {
    return this.offsets[this.offsets.length - 1];
  }
  // 二分：找到第一个"底部偏移 > scrollTop"的行 = 首个可见行
  firstVisible(scrollTop: number): number {
    let lo = 0;
    let hi = this.heights.length - 1;
    let ans = this.heights.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.offsets[mid + 1] > scrollTop) {
        ans = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    return ans;
  }
  window(scrollTop: number, viewportH: number, overscan = 3): Window {
    const first = this.firstVisible(scrollTop);
    const start = Math.max(0, first - overscan);
    let end = first;
    const bottomEdge = scrollTop + viewportH;
    while (end < this.heights.length && this.offsets[end] < bottomEdge) end++;
    return {
      start,
      end: Math.min(this.heights.length, end + overscan),
      offsetTop: this.offsets[start],
      totalHeight: this.totalHeight(),
    };
  }
  // 行高变化（展开/收起）：更新并重算受影响之后的前缀和
  updateHeight(index: number, newH: number) {
    const delta = newH - this.heights[index];
    if (delta === 0) return;
    this.heights[index] = newH;
    for (let i = index + 1; i < this.offsets.length; i++) this.offsets[i] += delta;
  }
}

// --- 滚动锚定：上方行高变化时,保持当前可视内容不跳动 ---
// 返回需要补偿的 scrollTop 增量
function anchorCompensation(changedIndex: number, delta: number, firstVisible: number): number {
  return changedIndex < firstVisible ? delta : 0; // 变化在视口上方才需补偿
}

// ---- 断言 ----
// 固定行高
const w1 = windowFixed({ scrollTop: 0, viewportH: 300, rowH: 30, total: 10000 });
console.assert(w1.start === 0 && w1.end === 13 && w1.totalHeight === 300000, "首屏窗口含 overscan");
const w2 = windowFixed({ scrollTop: 150000, viewportH: 300, rowH: 30, total: 10000, overscan: 0 });
console.assert(w2.start === 5000 && w2.end === 5010 && w2.offsetTop === 150000, "中段窗口精确");
const w3 = windowFixed({ scrollTop: 299990, viewportH: 300, rowH: 30, total: 10000, overscan: 0 });
console.assert(w3.end === 10000, "尾部不越界");

// 动态行高
const idx = new DynamicHeightIndex([30, 50, 30, 80, 30]); // 总高 220
console.assert(idx.totalHeight() === 220, "前缀和总高");
console.assert(idx.firstVisible(0) === 0 && idx.firstVisible(30) === 1, "边界行定位");
console.assert(idx.firstVisible(79) === 1 && idx.firstVisible(80) === 2, "跨行边界精确定位");
// 视口 [80,140) 覆盖行2(80-110)与行3(110-190):end=4(不含),行3 底部超出视口仍渲染
const dw = idx.window(80, 60, 0);
console.assert(dw.start === 2 && dw.end === 4, "动态窗口覆盖视口");
// 行高变化 + 锚定补偿
idx.updateHeight(1, 70); // 第 1 行 50→70,总高 240;行1 区间变为 [30,100)
console.assert(idx.totalHeight() === 240, "行高变更重算总高");
console.assert(idx.firstVisible(80) === 1, "变更后定位仍正确（80 落在行1 新区间）");
console.assert(anchorCompensation(1, 20, 2) === 20, "视口上方变高,scrollTop 补偿 +20 不跳动");
console.assert(anchorCompensation(4, 20, 2) === 0, "视口下方变化无需补偿");

console.log("✅ 固定/动态行高窗口 / 前缀和二分 / 滚动锚定全部通过");
