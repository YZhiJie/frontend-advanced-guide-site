// 文件: examples/02-02-generics.ts
// ============ 泛型:从工具函数到强类型 API 层 ============

// ---- 基础:泛型保留入参类型 ----
function firstElement<T>(arr: readonly T[]): T | undefined {
    return arr[0];
}
const n = firstElement([1, 2, 3]);        // n: number | undefined
const s = firstElement(['a']);            // s: string | undefined

// ---- 约束:保证入参有某个形状 ----
function pick<T, K extends keyof T>(obj: T, key: K): T[K] {
    return obj[key]; // 有了 K extends keyof T 约束,这里才能安全索引
}
const user = { id: 1, name: 'Alice', admin: true };
const name = pick(user, 'name');  // name: string —— 返回类型精确对应所选 key
// pick(user, 'age');              // ❌ 编译错误:'age' 不存在于 keyof user

// ---- 默认类型:让泛型参数可省略 ----
interface ApiResponse<T = unknown> {
    code: number;
    data: T;
    message: string;
}
const res1: ApiResponse = { code: 0, data: null, message: 'ok' };       // T = unknown
const res2: ApiResponse<{ id: number }[]> = { code: 0, data: [{ id: 1 }], message: 'ok' };

// ---- 泛型函数重载:参数与返回值的多形态精确匹配 ----
function createElement(tag: 'div'): HTMLDivElement;
function createElement(tag: 'span'): HTMLSpanElement;
function createElement(tag: 'input'): HTMLInputElement;
function createElement(tag: string): HTMLElement {
    return document.createElement(tag); // [浏览器] 运行环境需要 DOM
}
// const input = createElement('input'); // [浏览器] HTMLInputElement —— 重载按字面量精确匹配

// ---- 实战:类型安全的事件订阅(事件名 → 载荷 强关联)----
interface EventMap {
    login: { userId: string; time: number };
    logout: undefined;
}
class TypedEventBus<E extends Record<string, unknown>> {
    private handlers = new Map<keyof E, Set<(payload: never) => void>>();

    on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): () => void {
        let set = this.handlers.get(event);
        if (!set) this.handlers.set(event, (set = new Set()));
        set.add(handler as (payload: never) => void);
        return () => set!.delete(handler as (payload: never) => void);
    }

    emit<K extends keyof E>(event: K, payload: E[K]): void {
        [...(this.handlers.get(event) ?? [])].forEach((h) => (h as (p: E[K]) => void)(payload));
    }
}

const bus = new TypedEventBus<EventMap>();
bus.on('login', ({ userId, time }) => console.log(userId, time)); // 载荷类型自动推导
bus.emit('login', { userId: '1', time: Date.now() });
// bus.emit('login', { userId: '1' });            // ❌ 编译错误:缺少 time
// bus.on('logout', (p) => p.xxx);                // ❌ logout 载荷是 undefined
