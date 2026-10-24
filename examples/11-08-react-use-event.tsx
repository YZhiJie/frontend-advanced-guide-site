/**
 * 11-08 React 接入 EventBus —— useSyncExternalStore 的正确姿势
 * [React 19] 需放入 React 项目(Vite)运行;本文件为示意代码,以阅读理解为主。
 *
 * 设计决策:
 * 1. 参与渲染的事件源用 useSyncExternalStore —— 官方为"外部 store/事件源"设计的 Hook,
 *    避免 useEffect + setState 造成的一次额外渲染与撕裂问题;
 * 2. getSnapshot 必须返回缓存的快照值(不能每次返回新对象),否则无限渲染;
 * 3. 不参与渲染的普通订阅用 useEffect + cleanup,on() 返回的解绑函数正好当 cleanup。
 */

import { useSyncExternalStore, useEffect } from 'react';

type CartEvents = { 'cart:changed': { count: number } };
// import { EventBus } from './11-04-eventbus';
// const bus = new EventBus<CartEvents>(); // 实际项目中 EventBus 从模块导入并单例导出;此处示意
declare const bus: {
    on<K extends keyof CartEvents>(event: K, handler: (p: CartEvents[K]) => void): () => void;
};

let snapshotCount = 0;
// bus.on('cart:changed', (p) => { snapshotCount = p.count; }); // 模块加载时同步缓存快照(emit 时更新)

function useCartCount() {
    // getSnapshot 返回缓存值;订阅变化时 bus emit 内部更新 snapshot 并触发重渲染
    return useSyncExternalStore(
        (cb) => bus.on('cart:changed', cb) as unknown as () => void, // subscribe:返回解绑函数
        () => snapshotCount, // getSnapshot:读缓存快照
        () => 0, // getServerSnapshot(SSR 初始值)
    );
}

function Header() {
    const count = useCartCount();
    return <span>购物车({count})</span>;
}

// ⚠️ 普通事件订阅(不参与渲染)用 useEffect + cleanup:
function useEventListener<K extends keyof CartEvents>(event: K, handler: (p: CartEvents[K]) => void) {
    useEffect(() => bus.on(event, handler), [event, handler]); // on 返回解绑函数,正好是 cleanup
}

export { Header, useCartCount, useEventListener };
