/**
 * 11-04 EventBus —— 类型安全的发布订阅实现
 *
 * 设计决策:
 * 1. 用 Map<事件名, Set<handler>> 而非数组:Set 保证重复 on 自动去重,delete 是 O(1);
 * 2. on() 返回解绑函数而非要求手动 off —— 与 useEffect cleanup / onUnmounted 天然对齐,漏解绑概率大幅下降;
 * 3. emit 时复制 handler 集合再遍历 —— 防止 handler 内 on/off 修改集合导致遍历跳变;
 * 4. 单个 handler 出错用 try/catch 隔离 —— 与 DOM 事件语义一致,一个订阅者异常不阻断其他订阅者。
 *
 * 坑点:
 * - off 必须传与 on 相同的函数引用,匿名函数永远解绑失败(内存泄漏头号来源);
 * - once 的实现是"包装函数先解绑自身再执行",防止 handler 内再次 emit 造成重入;
 * - EventBus 实例是页面级的,跨 Tab 请用 BroadcastChannel(见 18-worker-messaging)。
 */

type Handler<T = unknown> = (payload: T) => void;

class EventBus<Events extends Record<string, unknown>> {
    private map = new Map<keyof Events, Set<Handler>>();

    /** 订阅;返回取消函数(比手动存引用再 off 更不易泄漏) */
    on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
        let set = this.map.get(event);
        if (!set) {
            set = new Set();
            this.map.set(event, set);
        }
        set.add(handler as Handler);
        return () => this.off(event, handler); // ✅ 返回解绑函数,组件卸载时直接调用
    }

    /** 一次性订阅:执行后自动移除 */
    once<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
        const wrap: Handler<Events[K]> = (payload) => {
            this.off(event, wrap); // 先移除再执行,防止 handler 内再次 emit 造成重入
            handler(payload);
        };
        return this.on(event, wrap);
    }

    off<K extends keyof Events>(event: K, handler: Handler<Events[K]>) {
        this.map.get(event)?.delete(handler as Handler);
    }

    emit<K extends keyof Events>(event: K, payload: Events[K]) {
        // 复制一份再遍历:防止 handler 内 on/off 修改集合导致遍历异常
        [...(this.map.get(event) ?? [])].forEach((h) => {
            try {
                h(payload);
            } catch (e) {
                // ✅ 单个订阅者出错不阻断其他订阅者(与 DOM 事件语义一致)
                console.error(`[EventBus] handler for "${String(event)}" failed:`, e);
            }
        });
    }
}

// ---- 使用:事件名与载荷类型强关联,emit 传错参数直接编译报错 ----
interface AppEvents {
    'user:login': { userId: string; from: 'email' | 'oauth' };
    'cart:changed': { count: number };
}

const bus = new EventBus<AppEvents>();

const offLogin = bus.on('user:login', (p) => console.log('欢迎', p.userId, '登录方式', p.from));
bus.once('cart:changed', (p) => console.log('首次加购,数量:', p.count));

bus.emit('user:login', { userId: 'u_1', from: 'oauth' }); // 欢迎登录
bus.emit('cart:changed', { count: 1 }); // 首次加购
bus.emit('cart:changed', { count: 2 }); // 已被 once 移除,无输出
offLogin(); // 组件卸载时解绑

// bus.emit('user:login', { userId: 'u_1', from: 'wechat' }); // ❌ 编译报错:from 类型不符

// ---- ⚠️ 坑:handler 引用必须一致才能 off —— 匿名函数解绑永远失败 ----
const h1 = (p: { count: number }) => console.log(p);
bus.on('cart:changed', h1);
bus.off('cart:changed', h1); // ✅ 同一引用,解绑成功
// bus.on('cart:changed', (p) => console.log(p)); bus.off(..., 同样字面量) // ❌ 不同引用

export {};
