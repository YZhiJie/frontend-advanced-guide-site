// 防抖(对应文档 1.8)
export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 300, immediate = false) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return function (this: unknown, ...args: never[]) {
        if (timer) clearTimeout(timer);
        if (immediate && !timer) fn.apply(this, args);
        timer = setTimeout(() => {
            timer = null;
            if (!immediate) fn.apply(this, args);
        }, wait);
    };
}
