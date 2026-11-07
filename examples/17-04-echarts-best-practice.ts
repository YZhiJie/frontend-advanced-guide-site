// 文件: examples/17-04-echarts-best-practice.ts —— ECharts 业务实践要点(配置骨架)
// npm i echarts —— 90% 的业务图表注意事项集中在以下几点
// import * as echarts from 'echarts';

function renderChart(dom: HTMLElement, data: { name: string; value: number }[]) {
    // ① 按需引入:只打包用到的图表与组件(体积从 1MB+ 降到 300KB 级)
    // const chart = echarts.init(dom, null, { renderer: 'svg' });
    //    ↑ 需要无障碍/大量图表实例时选 svg 渲染器;大数据量选 canvas(默认)

    const option = {
        animationDurationUpdate: 300,
        // ② 大数据量:开启渐进渲染 + 采样,万级数据不掉帧
        series: [{
            type: 'line',
            large: true,                  // 大数据模式
            sampling: 'lttb',             // 降采样保留波形
            progressive: 2000,            // 渐进渲染,避免一次性布局
            data: data.map((d) => [d.name, d.value]),
        }],
        // ③ dataZoom 内置缩放,别自己造
        // dataZoom: [{ type: 'inside' }],
    };
    // chart.setOption(option);
    // ④ 容器 resize 时必须 chart.resize();组件卸载时 chart.dispose()(防内存泄漏,呼应 1.6)
}
export {};
