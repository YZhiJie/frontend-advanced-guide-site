// 文件: examples/11-01-patterns.ts
// ============ 四个高频模式的前端落地 ============

// ---- 1. 单例:全局唯一的弹窗管理器(闭包 + 惰性创建)----
class ToastManager {
    private static instance: ToastManager | null = null;
    private container: HTMLElement | null = null;

    private constructor() {} // 禁止外部 new

    static getInstance(): ToastManager {
        if (!ToastManager.instance) {
            ToastManager.instance = new ToastManager();
        }
        return ToastManager.instance;
    }

    show(message: string) {
        // 惰性创建 DOM 容器
        this.container ??= document.createElement('div');
        const toast = document.createElement('div');
        toast.textContent = message;
        this.container.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }
}
// ToastManager.getInstance() === ToastManager.getInstance() // true

// ---- 2. 策略:消灭表单校验的 if 长链 ----
type ValidateFn = (value: string) => string | null; // 返回 null 表示通过

const validators: Record<string, ValidateFn> = {
    required: (v) => (v.trim() ? null : '必填项'),
    phone: (v) => (/^1[3-9]\d{9}$/.test(v) ? null : '手机号格式不正确'),
    password: (v) => (v.length >= 8 ? null : '密码至少 8 位'),
};

// 新增规则 = 加一行注册,不改已有逻辑(开闭原则)
validators.email = (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : '邮箱格式不正确');

function validateField(value: string, rules: ValidateFn[]): string | null {
    for (const rule of rules) {
        const error = rule(value);
        if (error) return error; // 返回第一个错误
    }
    return null;
}

console.log(validateField('13800138000', [validators.required, validators.phone])); // null
console.log(validateField('123', [validators.required, validators.password]));      // '密码至少 8 位'

// ---- 3. 代理:图片懒加载(IntersectionObserver + 缓存去重)----
function createLazyImageLoader(rootMargin = '200px') {
    const loaded = new WeakSet<HTMLImageElement>();
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const img = entry.target as HTMLImageElement;
            if (loaded.has(img)) return;
            img.src = img.dataset.src ?? '';
            loaded.add(img);
            obs.unobserve(img); // 加载一次即停止观察
        });
    }, { rootMargin: `${rootMargin} 0px` }); // 提前 200px 预加载

    return (img: HTMLImageElement) => observer.observe(img);
}
// 所有 img[data-src] 交给它:const lazyLoad = createLazyImageLoader();

// ---- 4. 装饰器思想的高阶函数:给任意异步函数加缓存 + 去重 ----
function withCache<A extends unknown[], R>(
    fn: (...args: A) => Promise<R>,
    keyFn: (...args: A) => string = (...args) => JSON.stringify(args),
) {
    const cache = new Map<string, Promise<R>>();
    return (...args: A): Promise<R> => {
        const key = keyFn(...args);
        if (!cache.has(key)) {
            const promise = fn(...args).catch((e) => {
                cache.delete(key); // 失败不缓存,下次重试
                throw e;
            });
            cache.set(key, promise);
        }
        return cache.get(key)!; // 并发调用共享同一个 Promise(请求去重)
    };
}

let fetchCount = 0;
const fetchUserCached = withCache(async (id: string) => {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 50));
    return { id, name: 'Alice' };
});

await Promise.all([fetchUserCached('1'), fetchUserCached('1')]); // 并发去重:实际只发一次
await fetchUserCached('1'); // 命中缓存
console.log('实际请求次数:', fetchCount); // 1
export {};
