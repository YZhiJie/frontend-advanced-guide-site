/**
 * 11-12 qiankun 主应用侧 —— 注册子应用 + 启动 + 全局状态
 * [浏览器] 需配合 qiankun 依赖与子应用联调;本文件为示意代码,以阅读理解为主。
 *
 * 设计决策:
 * 1. activeRule 与子应用路由前缀必须一致 —— 子应用 base 要按这个前缀设置;
 * 2. entry 生产建议由配置中心下发 —— 便于子应用独立发布与灰度;
 * 3. 样式隔离默认不开 Shadow DOM(strictStyleIsolation) —— 用 experimentalStyleIsolation
 *    的作用域前缀方案,代价最小;弹窗类组件需统一指定挂载容器。
 *
 * 坑点:
 * - beforeUnload/beforeUnmount 钩子里清理主应用为子应用挂的全局监听;
 * - 主应用路由要兜底:子应用卸载后 activeRule 残留路径需要重定向。
 */

// import { registerMicroApps, start, initGlobalState, loadMicroApp } from 'qiankun';

// ---- 1. 注册子应用:activeRule 与子应用路由前缀必须一致 ----
// registerMicroApps(
//     [
//         {
//             name: 'sub-react',
//             entry: '//localhost:7001',      // 子应用入口,生产建议由配置中心下发
//             container: '#sub-container',    // 挂载点
//             activeRule: '/react',           // URL 前缀匹配即挂载
//             props: { token: 'xxx', theme: 'dark' }, // 下发全局数据(只读约定)
//         },
//         { name: 'sub-vue', entry: '//localhost:7002', container: '#sub-container', activeRule: '/vue' },
//     ],
//     {
//         // 生命周期钩子:全局 loading / 埋点都挂这里
//         beforeLoad: (app) => console.log('开始加载', app.name),
//         afterMount: (app) => console.log('挂载完成', app.name),
//         // ⚠️ beforeUnmount 里记得清掉主应用为子应用挂的定时器/全局监听(如果有)
//     },
// );

// ---- 2. 启动:预加载 + 沙箱配置 ----
// start({
//     prefetch: 'all',          // 首屏空闲时预取所有子应用资源
//     sandbox: { strictStyleIsolation: false }, // true = Shadow DOM,样式彻底隔离但弹窗/全局样式会有坑
//     // experimentalStyleIsolation: true,     // 折中:给子应用样式加作用域前缀(用 scoped 思路)
// });

// ---- 3. 全局状态:主/子应用共享的响应式 store ----
// const actions = initGlobalState({ user: null, locale: 'zh-CN' });
// actions.onGlobalStateChange((state, prev) => console.log('主应用感知到变化', state, prev));
// // 子应用里:export const onGlobalStateChange = actions.onGlobalStateChange(同款回调)

export {};
