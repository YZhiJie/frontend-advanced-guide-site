import { describe, expect, it } from 'vitest';
import { toCents, formatPrice, applyDiscount } from '@/utils/money';

describe('toCents 金额转分', () => {
    it('常规金额', () => {
        expect(toCents(12.34)).toBe(1234);
    });

    it('经典浮点陷阱:0.1 + 0.2 !== 0.3', () => {
        expect(0.1 + 0.2).not.toBe(0.3);
        expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));
    });

    it('折扣:正常与越界', () => {
        expect(applyDiscount(toCents(100), 20)).toBe(8000);
        expect(() => applyDiscount(1000, 120)).toThrow(RangeError);
    });

    it('formatPrice 与 toCents 互逆', () => {
        expect(formatPrice(toCents(99.99))).toBe('99.99');
    });
});
