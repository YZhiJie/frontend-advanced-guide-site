import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '@/utils/debounce';

describe('debounce', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('连续触发只在停止后执行一次', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 300);

        debounced();
        vi.advanceTimersByTime(100);
        debounced();
        vi.advanceTimersByTime(299);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('参数正确透传', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);
        debounced('a', 'b');
        vi.runAllTimers();
        expect(fn).toHaveBeenCalledWith('a', 'b');
    });
});
