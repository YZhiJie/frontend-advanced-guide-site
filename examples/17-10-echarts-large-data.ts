// 文件: examples/17-10-echarts-large-data.ts —— [浏览器] ECharts 百万级数据配置
// npm i echarts
// import * as echarts from 'echarts';
// import { LineChart, GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/charts';
// echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent]); // 按需引入

interface EChartsOption {
  series: Array<{
    type: string;
    large?: boolean;
    progressive?: number;
    sampling?: string;
    data: [string, number][];
    [key: string]: unknown;
  }>;
  animationDurationUpdate?: number;
  dataZoom?: Array<{
    type: string;
    rangeMode?: string[];
    start?: number;
    end?: number;
  }>;
  [key: string]: unknown;
}

function createLargeDataChart(dom: HTMLElement, count: number): EChartsOption {
  // 生成百万级测试数据
  const data: [string, number][] = [];
  let base = 0;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    base += (Math.random() - 0.45) * 20;
    data.push([
      new Date(now - (count - i) * 1000).toISOString(),
      Math.round(base),
    ]);
  }

  return {
    animationDurationUpdate: 0, // 大数据时关闭动画 —— 动画本身就是长任务
    series: [
      {
        type: "line",
        large: true, // ① 大数据模式:跳过非视觉元素的逐个处理
        sampling: "lttb", // ② LTTB 降采样:保留波形特征,不是简单抽样
        progressive: 5000, // ③ 渐进渲染:每帧最多渲染 5000 个点
        progressiveThreshold: 10000, // 超过 1 万点才启用渐进,小数据直接渲染更快
        data,
        // ④ showSymbol 设为 false:不画每个数据点的标记(万级点标记是性能杀手)
        showSymbol: false,
        // ⑤ hover 层级限制:不渲染所有 tooltip,只渲染最近的
        emphasis: { disabled: true },
      },
    ],
    dataZoom: [
      { type: "inside", rangeMode: ["value", "percent"], start: 80, end: 100 }, // 默认只看最后 20%
    ],
    // ⑥ tooltip 模式设为 axis(整列高亮)而非 item(逐点高亮)
    tooltip: { trigger: "axis" },
  };
}

// ---- 生命周期管理(防内存泄漏的头号规则)----
function setupChart(dom: HTMLElement) {
  // const chart = echarts.init(dom, null, { renderer: 'canvas' }); // 大数据用 canvas
  // chart.setOption(createLargeDataChart(dom, 1_000_000));

  let resizeTimer: ReturnType<typeof setTimeout>;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // chart.resize(); // 防抖 resize:频繁 resize 会闪屏
    }, 200);
  };
  window.addEventListener("resize", onResize);

  // ✅ 清理函数:卸载时必须调
  return () => {
    window.removeEventListener("resize", onResize);
    clearTimeout(resizeTimer);
    // chart.dispose(); // 释放实例与事件监听 —— 漏了就是内存泄漏(呼应 1.6)
  };
}

export {};
