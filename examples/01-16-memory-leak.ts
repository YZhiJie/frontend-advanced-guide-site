// 文件: examples/01-16-memory-leak.ts
// ============ 四大常见内存泄漏模式(浏览器环境示意)============

// ---- 泄漏 1:被遗忘的定时器 ----
function startPolling() {
    const bigData = new Array(100000).fill('x');
    setInterval(() => {
        console.log(bigData.length); // bigData 被 interval 的回调闭包持有,永远无法回收
    }, 1000);
    // ✅ 修复:保存 timer id,在合适的时机(组件卸载/页面离开)clearInterval
}

// ---- 泄漏 2:事件监听未移除 ----
function mount(el: HTMLElement) {
    const onClick = () => console.log('clicked');
    el.addEventListener('click', onClick);
    // ✅ 修复:卸载时 el.removeEventListener('click', onClick)
    // React 的 useEffect 返回清理函数、Vue 的 onUnmounted 都是干这个的
}

// ---- 泄漏 3:闭包持有大对象 ----
function createHandler() {
    const hugeList = new Array(1e6).fill({ detail: '很多数据' });
    return () => hugeList.length; // 只要返回的函数活着,hugeList 就活着
    // ✅ 修复:只保留真正需要的字段,如 return () => hugeList.length 改为先取 count = hugeList.length
}

// ---- 泄漏 4:全局变量累积 / 被遗忘的 Map 缓存 ----
const cache = new Map<string, unknown>();
function addToCache(key: string, value: unknown) {
    cache.set(key, value); // 以长生命周期对象为 key,value 永远不会被回收
}
// ✅ 修复:以"短生命周期对象"为 key 用 WeakMap(见下方对比)

// ---- WeakMap vs Map:key 的回收行为 ----
let obj = { data: new Array(1e6) };

const strongMap = new Map();
strongMap.set(obj, 'metadata'); // Map 强引用 obj → 即使 obj = null 也不会被回收

const weakMap = new WeakMap<object, string>();
weakMap.set(obj, 'metadata');   // WeakMap 弱引用 obj → obj 置 null 后可被正常回收

obj = null as any;
console.log(strongMap.size); // 1 —— 强引用还在
// weakMap 无法遍历,但内部条目会随 obj 一起被 GC
