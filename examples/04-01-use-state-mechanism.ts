// 文件: examples/04-01-use-state-mechanism.ts
// ============ Hooks 原理示意:索引链表模型(极简教学版,非 React 源码)============

interface HookNode { state: unknown; queue: unknown[] }

// 模拟:每个组件实例在 Fiber 外部持有一个 hooks 链表 + 当前处理索引
const hooks: HookNode[] = [];
let hookIndex = 0;
let isRendering = false;

function useState<T>(initial: T): [T, (action: T | ((prev: T) => T)) => void] {
    const currentIndex = hookIndex;

    // 首次渲染:初始化节点;再次渲染:复用上一次的节点(状态得以跨渲染保存)
    if (!hooks[currentIndex]) {
        hooks[currentIndex] = { state: initial, queue: [] };
    }
    const hook = hooks[currentIndex];

    function dispatch(action: T | ((prev: T) => T)) {
        // React 中 dispatch 是异步批处理的;这里简化为直接更新并触发重渲染
        hook.state = typeof action === 'function' ? (action as (p: T) => T)(hook.state as T) : action;
        scheduleRerender();
    }

    hookIndex++; // 关键:每次调用 useState,索引前移 —— 顺序即身份
    return [hook.state as T, dispatch];
}

function useEffect(effect: () => void | (() => void), deps?: unknown[]) {
    const currentIndex = hookIndex++;
    if (!hooks[currentIndex]) hooks[currentIndex] = { state: undefined, queue: [] }; // 首次渲染初始化节点
    const prevDeps = (hooks[currentIndex].state as unknown[] | undefined) ?? [];
    const changed =
        deps === undefined ||
        deps.length !== prevDeps.length ||
        deps.some((d, i) => !Object.is(d, prevDeps[i]));

    if (changed) {
        queueMicrotask(() => {
            (hooks[currentIndex].queue as Array<() => void>).forEach((cleanup) => cleanup()); // 先执行上次清理
            hooks[currentIndex].queue = [];
            const cleanup = effect();
            if (typeof cleanup === 'function') hooks[currentIndex].queue.push(cleanup);       // 再保存新清理
        });
        hooks[currentIndex].state = deps ?? [];
    }
}

function render<T>(Component: () => T): T {
    hookIndex = 0;      // 每次渲染索引归零,按同样的顺序取用 Hook
    isRendering = true;
    const result = Component();
    isRendering = false;
    return result;
}

let rerenderScheduled = false;
function scheduleRerender() {
    if (rerenderScheduled) return; // 批处理:同一批的多次 setState 只触发一次重渲染
    rerenderScheduled = true;
    setTimeout(() => {
        rerenderScheduled = false;
        void render(App);
    }, 100);
}

// ---- 演示:顺序错乱会发生什么 ----
function App() {
    const [count, setCount] = useState(0);
    const [name, setName] = useState('Alice');
    useEffect(() => console.log('count 变了:', count), [count]);

    console.log(`渲染:count=${count}, name=${name}`);

    // ❌ 如果在条件分支里调用 useState,本次渲染 hookIndex 错位,
    //    setName 会拿到"count 的 hook" —— 这就是官方规则"不要在条件/循环中调用 Hook"的原理
    return { count, setCount, name, setName };
}

const app = render(App);
app.setCount(1); // 触发异步批处理重渲染(100ms 后),观察依赖变化日志
