// 文件: examples/09-02-money.test.ts —— Vitest 单测全特性示例
// 本文件自包含(被测代码内联),可在 examples/ 目录直接运行:npx vitest run 09-02-money.test.ts
//
// 涵盖:基本断言、浮点互逆、参数化 it.each、异常分支 toThrow、
//       假定时器 vi.useFakeTimers、vi.fn spy、模块边界 mock、rejects 断言

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ============================ 被测代码(内联) ============================
function toCents(yuan: number): number {
    return Math.round(yuan * 100);
}

function formatPrice(cents: number): string {
    return (cents / 100).toFixed(2);
}

function applyDiscount(cents: number, percent: number): number {
    if (percent < 0 || percent > 100) throw new RangeError('折扣需在 0~100 之间');
    return Math.round((cents * (100 - percent)) / 100); // 以"分"为单位取整,规避浮点误差
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, wait = 200) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return function (this: unknown, ...args: A) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

// 模拟"调用 http 层"的业务函数
interface HttpLike { get: (url: string) => Promise<unknown>; }
let http: HttpLike;            // 在测试中通过 vi.mock 注入
async function fetchUserProfile(id: string) {
    const data = await http.get(`/user/${id}`) as { id: string; name: string };
    return data;
}
// =====================================================================

describe('toCents 金额转分', () => {
    it('常规金额', () => {
        expect(toCents(12.34)).toBe(1234);
    });

    it('经典浮点陷阱:0.1 + 0.2 !== 0.3', () => {
        expect(0.1 + 0.2).not.toBe(0.3);                          // 0.30000000000000004
        expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));  // ✅ 整数运算规避浮点误差
    });

    // 参数化测试:一张表覆盖多边界,失败时清楚是哪一行
    it.each([[0], [99.99], [1e6]])('边界值 %d 互逆', (input) => {
        expect(formatPrice(toCents(input))).toBe(input.toFixed(2));
    });

    // 异常分支必须覆盖,否则 throw 形同未测
    it('折扣越界抛 RangeError', () => {
        expect(() => applyDiscount(1000, -1)).toThrow(RangeError);
        expect(() => applyDiscount(1000, 101)).toThrow(/0~100/);
    });
});

describe('debounce 假定时器测试', () => {
    beforeEach(() => vi.useFakeTimers());   // 假定时器:测试不需要真的等 300ms
    afterEach(() => vi.useRealTimers());

    it('连续触发只在停止后执行一次', () => {
        const fn = vi.fn();                  // vi.fn = spy,既可断言调用次数也可指定返回
        const debounced = debounce(fn, 300);

        debounced();
        vi.advanceTimersByTime(100);
        debounced();                          // 中途再次触发 → 重新计时
        vi.advanceTimersByTime(299);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);            // 距最后一次触发恰好 300ms
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('参数与 this 正确透传', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);
        debounced('a', 'b');
        vi.runAllTimers();
        expect(fn).toHaveBeenCalledWith('a', 'b');
    });
});

// ---- Mock 外部依赖:只在"模块边界"mock,不 mock 被测函数内部 ----
describe('fetchUserProfile 模块边界 mock', () => {
    it('成功时返回用户数据', async () => {
        http = { get: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }) };
        const user = await fetchUserProfile('1');
        expect(user.name).toBe('Alice');
        expect(http.get).toHaveBeenCalledWith('/user/1');
    });

    it('网络错误抛异常', async () => {
        http = { get: vi.fn().mockRejectedValue(new Error('Network')) };
        await expect(fetchUserProfile('1')).rejects.toThrow('Network');
    });
});
