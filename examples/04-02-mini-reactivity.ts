// 文件: examples/04-02-mini-reactivity.ts
// ============ 手写 Vue3 迷你响应式系统(核心约 60 行)============

type EffectFn = (() => void) & { deps: Set<Set<EffectFn>> };

let activeEffect: EffectFn | null = null;
const effectStack: EffectFn[] = [];

// 全局依赖图:target → key → 依赖该 key 的 effect 集合
const targetMap = new WeakMap<object, Map<string | symbol, Set<EffectFn>>>();

function track(target: object, key: string | symbol) {
    if (!activeEffect) return; // 不在 effect 中读取,无需收集
    let depsMap = targetMap.get(target);
    if (!depsMap) targetMap.set(target, (depsMap = new Map()));
    let deps = depsMap.get(key);
    if (!deps) depsMap.set(key, (deps = new Set()));
    if (!deps.has(activeEffect)) {
        deps.add(activeEffect);
        activeEffect.deps.add(deps); // 双向记录,便于清理(解决分支切换的"脏依赖")
    }
}

function trigger(target: object, key: string | symbol) {
    const deps = targetMap.get(target)?.get(key);
    if (!deps) return;
    // 拷贝一份再遍历:防止 effect 执行中增删依赖导致死循环
    [...deps].forEach((fn) => {
        // 避免"effect 内部又触发了自己"(如 count++ 递归)
        if (fn !== activeEffect) fn();
    });
}

function cleanup(effectFn: EffectFn) {
    effectFn.deps.forEach((deps) => deps.delete(effectFn));
    effectFn.deps.clear();
}

/** effect:响应式的副作用,数据变化时自动重新执行 */
function effect(fn: () => void): EffectFn {
    const effectFn: EffectFn = (() => {
        cleanup(effectFn);             // 重新执行前清掉旧依赖,再按本次分支重新收集
        effectStack.push(effectFn);
        activeEffect = effectFn;
        fn();
        effectStack.pop();
        activeEffect = effectStack[effectStack.length - 1] ?? null; // 支持嵌套 effect
    }) as EffectFn;
    effectFn.deps = new Set();
    effectFn();
    return effectFn;
}

// ---- reactive:Proxy 拦截读写 ----
const proxyMap = new WeakMap<object, object>();

function reactive<T extends object>(obj: T): T {
    const existing = proxyMap.get(obj);
    if (existing) return existing as T; // 同一对象只代理一次,保证 === 相等

    const proxy = new Proxy(obj, {
        get(target, key, receiver) {
            track(target, key);
            const result = Reflect.get(target, key, receiver);
            // 深层响应式:嵌套对象继续代理
            return result !== null && typeof result === 'object' ? reactive(result as object) : result;
        },
        set(target, key, value, receiver) {
            const oldValue = (target as Record<string | symbol, unknown>)[key];
            const success = Reflect.set(target, key, value, receiver);
            // 值真正变化才触发,避免无意义的重渲染
            if (success && !Object.is(oldValue, value)) trigger(target, key);
            return success;
        },
        deleteProperty(target, key) {
            const hadKey = Reflect.has(target, key);
            const success = Reflect.deleteProperty(target, key);
            if (hadKey) trigger(target, key); // 删除属性也要触发(for...in 依赖 key 数量)
            return success;
        },
    }) as T;
    proxyMap.set(obj, proxy);
    return proxy;
}

// ---- 验证:与 Vue3 的 reactive 使用体验一致 ----
const state = reactive({ count: 0, user: { name: 'Alice' }, list: [1] });

effect(() => {
    console.log('effect 触发, count =', state.count); // 依赖收集:count
});

state.count++;          // → effect 触发, count = 1
state.count = 1;        // → 值未变化,不触发(Object.is 比较)

// ---- 嵌套对象:读取链上每一级都会被代理与收集 ----
const profile = reactive({ user: { name: 'Alice' } });
effect(() => {
    console.log('profile effect:', profile.user.name); // 依赖:user 与 user.name 两级
});
profile.user.name = 'Bob'; // → profile effect: Bob —— 深层修改自动触发

// ---- 验证:分支切换后的依赖清理 ----
const ok = reactive({ flag: true, text: 'hello' });
effect(() => {
    // flag=true 时读取了 text;一旦 flag 变 false,text 就不该再触发本 effect
    console.log('分支 effect:', ok.flag ? ok.text : 'flag 为 false');
});
ok.text = 'world';  // → 触发(text 还是依赖)
ok.flag = false;    // → 触发
ok.text = 'again';  // → 不再触发 —— cleanup 清理了"脏依赖",这正是 Vue3 比 Vue2 精细的地方
