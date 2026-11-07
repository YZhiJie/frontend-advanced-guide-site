/**
 * 11-13 qiankun 子应用侧 —— 导出 bootstrap / mount / unmount 三生命周期
 * [浏览器] 需配合 qiankun 依赖联调;本文件为示意代码,以阅读理解为主。
 *
 * 设计决策:
 * 1. qiankun 协议:子应用必须导出 bootstrap(一次)/mount(每次进入)/unmount(每次离开);
 * 2. mount 挂载到 props.container 内的节点 —— 不要直接挂 document.body;
 * 3. unmount 必须彻底销毁实例并置空 —— "二进宫"报错 app 已挂载就是漏了这步;
 * 4. 独立运行分支:非 qiankun 环境自行 mount,联调效率天差地别。
 *
 * 坑点:
 * - publicPath 必须运行时修正,否则生产环境子应用 js/css 404(本地正常、上线翻车的经典现场);
 * - Vite 子应用需配合 vite-plugin-qiankun 或手动处理资源路径。
 */

// import { createApp, type App as VueApp } from 'vue';
// import Router from './router';
// import AppComponent from './App.vue';

// ⚠️ 坑:qiankun 环境下资源是动态插入的,publicPath 必须在运行时修正
// 否则生产环境子应用 js/css 404。webpack: __webpack_public_path__ = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__
// Vite 需在 index.html 里用 <script src="%BASE_URL%"> 动态注入或改用 vite-plugin-qiankun

// let app: VueApp | null = null;
//
// export async function bootstrap() {
//     console.log('[sub-vue] bootstrap:只执行一次,做全局初始化');
// }
//
// export async function mount(props: { container: HTMLElement; onGlobalStateChange: Function; setGlobalState: Function }) {
//     console.log('[sub-vue] mount:每次进入都执行');
//     app = createApp(AppComponent);
//     app.use(Router);
//     app.mount((props.container ?? document).querySelector('#app')!); // ⚠️ 挂到主应用给的容器里
// }
//
// export async function unmount() {
//     console.log('[sub-vue] unmount:必须彻底清理,否则切回时报"app 已挂载"');
//     app?.unmount();
//     app = null; // ✅ 置空实例 —— 最常见的子应用二进宫报错就是忘了这行
// }

// ---- 独立运行兼容:直接打开子应用自身也能跑(联调必备)----
// if (!window.__POWERED_BY_QIANKUN__) {
//     mount({ container: document.body } as any);
// }
export {};
