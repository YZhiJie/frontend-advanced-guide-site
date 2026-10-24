// 文件: examples/09-08-bench.ts —— Vitest bench:对工具函数做性能基准
// 本文件自包含(被测函数内联),可在 examples/ 目录直接运行:npx vitest bench 09-08-bench.ts
//
// 设计要点:
// 1. bench(name, fn, options) —— 给热点函数加护栏
// 2. 自动对比上次 baseline,回归 >10% 自动告警
// 3. iterations 控制最小样本量,1_000_000 次取平均更稳定
// 4. 适合 LRU、排序、深拷贝、虚拟列表 key 计算等热点函数
// 5. 写在 *.bench.ts 文件,npx vitest bench 专门跑

import { bench, describe } from 'vitest';

// 被测函数:整数运算规避浮点误差
function toCents(yuan: number): number {
    return Math.round(yuan * 100);
}

// 被测函数:乘 100 后用位运算取整(更快,但有 32 位整数限制)
function toCentsFast(yuan: number): number {
    return (yuan * 100) | 0;   // ⚠️ 仅适用于 |yuan*100| < 2^31 的场景
}

// 被测函数:简单深拷贝(仅供 bench 演示,生产请用 structuredClone)
function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

describe('toCents 性能对比', () => {
    bench('toCents 常规(Math.round)', () => {
        toCents(12.34);
    }, { iterations: 1_000_000 });

    bench('toCentsFast(位运算,适用范围受限)', () => {
        toCentsFast(12.34);
    }, { iterations: 1_000_000 });

    bench('大额 1e9', () => {
        toCents(1e9);
    });
});

describe('deepClone 性能', () => {
    const sample = { a: 1, b: { c: [1, 2, 3] }, d: 'hello' };

    bench('JSON.parse(JSON.stringify)', () => {
        deepClone(sample);
    }, { iterations: 100_000 });

    bench('structuredClone(原生 API)', () => {
        structuredClone(sample);
    }, { iterations: 100_000 });
});
