// 文件: examples/01-22-event-bus.ts
// ============ 发布订阅(EventEmitter):组件解耦的基石 ============

type Handler = (...args: unknown[]) => void;

class EventBus {
    private events = new Map<string, Set<Handler>>();

    /** 订阅;返回取消订阅函数(方便在组件卸载时清理) */
    on(event: string, handler: Handler): () => void {
        let set = this.events.get(event);
        if (!set) this.events.set(event, (set = new Set()));
        set.add(handler);
        return () => this.off(event, handler);
    }

    /** 只触发一次 */
    once(event: string, handler: Handler): void {
        const wrapped: Handler = (...args) => {
            this.off(event, wrapped); // 先移除再执行,防止执行中再次 emit
            handler(...args);
        };
        this.on(event, wrapped);
    }

    off(event: string, handler: Handler): void {
        this.events.get(event)?.delete(handler);
    }

    emit(event: string, ...args: unknown[]): void {
        // 拷贝一份,防止回调中 off 导致遍历异常
        [...(this.events.get(event) ?? [])].forEach((handler) => handler(...args));
    }
}

// ---- 验证 ----
const bus = new EventBus();
const off = bus.on('user:login', (name) => console.log('A 收到:', name));
bus.on('user:login', (name) => console.log('B 收到:', name));
bus.once('user:login', () => console.log('C 只收到一次'));

bus.emit('user:login', 'Alice'); // A、B、C 都收到
off();                            // A 取消订阅
bus.emit('user:login', 'Bob');    // 只有 B 收到
