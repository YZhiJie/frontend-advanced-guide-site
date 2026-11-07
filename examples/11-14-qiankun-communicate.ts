/**
 * 11-14 微前端通信选型 —— 四种方式与适用场景
 * [浏览器] 需配合 qiankun 联调;本文件为示意代码,以阅读理解为主。
 *
 * 选型口诀:全局数据用 globalState,一次性动作用 CustomEvent,页面导航用 URL,其余用 props。
 */

// ---- 方式 1:props 下发(推荐:数据流单向,最像组件通信)----
// registerMicroApps([{ name: 'sub', entry: '...', props: { token, getUser } }])
// 子应用在 mount(props) 里读取;主应用主动更新则用 loadMicroApp 手动重新下发

// ---- 方式 2:initGlobalState(全局响应式状态,适合 user/locale 等全局数据)----
// const actions = initGlobalState({ locale: 'zh-CN' });
// actions.setGlobalState({ locale: 'en-US' });           // 任意一方改,双方都收到通知
// actions.offGlobalStateChange();                        // ⚠️ unmount 时解绑,防泄漏

// ---- 方式 3:CustomEvent 总线(事件型通信,一次性动作如"打开弹窗")----
// 主应用:
// window.dispatchEvent(new CustomEvent('micro:notify', { detail: { type: 'toast', message: '保存成功' } }));
// 子应用:
// const handler = (e: Event) => console.log((e as CustomEvent).detail);
// window.addEventListener('micro:notify', handler);
// // ⚠️ unmount 时 window.removeEventListener('micro:notify', handler) —— 事件名加业务前缀防止冲突

// ---- 方式 4(最被低估):URL 参数(适合"跳到子应用某详情页"类导航)----
// history.pushState({}, '', '/vue/order/123'); 子应用路由自己解析 —— 天然可分享、可回退
export {};
