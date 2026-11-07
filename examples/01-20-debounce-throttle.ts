// 文件: examples/01-20-debounce-throttle.ts
// ============ 防抖与节流 ============

// ---- 防抖:停止触发 wait 毫秒后才执行一次("回城被打断就重来")----
// 场景:搜索框输入联想、窗口 resize 结束后重算布局、表单校验
function debounce<T extends (...args: never[]) => void>(fn: T, wait = 300, immediate = false) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return function (this: unknown, ...args: never[]) {
        if (timer) clearTimeout(timer);          // 每次触发都取消上一次等待
        if (immediate && !timer) fn.apply(this, args); // 立即执行版:首次触发立刻调用
        timer = setTimeout(() => {
            timer = null;
            if (!immediate) fn.apply(this, args); // 停止触发 wait 后执行
        }, wait);
    };
}

// ---- 节流:每 interval 毫秒最多执行一次,并保证最后一次触发也会执行(尾触发)----
// 场景:滚动加载、鼠标移动、按钮防连点(更高频、需要持续响应的场景)
function throttle<T extends (...args: never[]) => void>(fn: T, interval = 300) {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    return function (this: unknown, ...args: never[]) {
        const now = Date.now();
        const remaining = interval - (now - last);
        if (remaining <= 0) {
            last = now;
            fn.apply(this, args);       // 距上次执行已超过间隔,直接执行
        } else if (!timer) {
            timer = setTimeout(() => {  // 兜底:保证停手前的最后一次也能执行
                timer = null;
                last = Date.now();
                fn.apply(this, args);
            }, remaining);
        }
    };
}

// ---- 简易验证 ----
const log = (tag: string) => console.log(tag, '@', Date.now() % 10000);
const debounced = debounce(() => log('debounce'), 200);
const throttled = throttle(() => log('throttle'), 200);

// 模拟高频触发:每 50ms 一次,共 10 次
let i = 0;
const id = setInterval(() => {
    debounced(); // 只会在最后一次触发 200ms 后执行 1 次
    throttled(); // 大约每 200ms 执行 1 次
    if (++i >= 10) clearInterval(id);
}, 50);
