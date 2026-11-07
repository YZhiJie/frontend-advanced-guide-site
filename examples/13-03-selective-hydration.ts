// 文件: examples/13-03-selective-hydration.ts —— 选择性水合与调度优先级(概念示意)
// React 18+ 的 hydration 是并发的:
//   - 用户点击哪个区域,那个区域优先水合(Interaction 优先)
//   - 其余部分利用空闲时间逐步水合,长页面不再"整页卡一次"
// 对开发者的含义:
//   1. 首屏可交互时间(TTI)由"最关键交互组件"决定,而不是整页 JS 执行完
//   2. 不要在顶层塞一个巨大的同步组件阻塞整个水合队列
// 验证方式(Next.js):Performance 面板录制首屏,观察 hydrate 分段执行 + 点击优先
export {};
