// 文件: examples/02-08-decorators.ts
// ============ 装饰器:声明式的横切逻辑(需 experimentalDecorators)============

// ---- 方法装饰器:性能计时 ----
function timed(label?: string): MethodDecorator {
    return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
        const original = descriptor.value as (...args: unknown[]) => unknown;
        descriptor.value = function (this: unknown, ...args: unknown[]) {
            const start = performance.now();
            try {
                return original.apply(this, args);
            } finally {
                const cost = (performance.now() - start).toFixed(2);
                console.log(`[${label ?? String(propertyKey)}] 耗时 ${cost}ms`);
            }
        };
        return descriptor;
    };
}

// ---- 方法装饰器:错误兜底(失败不崩溃,返回默认值)----
function safe(fallback: unknown): MethodDecorator {
    return function (target, propertyKey, descriptor) {
        const original = descriptor.value as (...args: unknown[]) => unknown;
        descriptor.value = function (this: unknown, ...args: unknown[]) {
            try {
                return original.apply(this, args);
            } catch (e) {
                console.error(`方法 ${String(propertyKey)} 出错:`, (e as Error).message);
                return fallback;
            }
        };
        return descriptor;
    };
}

// ---- 类装饰器 + 拦截:所有方法自动计时 ----
function autoTimed<T extends new (...args: never[]) => unknown>(ctor: T): T {
    Object.getOwnPropertyNames(ctor.prototype).forEach((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, name);
        if (typeof descriptor?.value === 'function' && name !== 'constructor') {
            Object.defineProperty(ctor.prototype, name, timed(name)(ctor.prototype, name, descriptor));
        }
    });
    return ctor;
}

// ---- 使用 ----
@autoTimed
class ReportService {
    @timed('生成日报')
    generate() {
        let sum = 0;
        for (let i = 0; i < 1e6; i++) sum += i; // 模拟耗时
        return sum;
    }

    @safe(0)
    divide(a: number, b: number) {
        // ⚠️ JS 中 1/0 返回 Infinity 并不抛错,这里显式抛出以演示兜底
        if (b === 0) throw new Error('除数不能为 0');
        return a / b;
    }
}

const report = new ReportService();
report.generate();
report.divide(1, 0); // 不崩溃,返回 0
