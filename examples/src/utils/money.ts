// 金额工具:以"分"为单位规避浮点误差(对应文档 9.2)
export function toCents(yuan: number): number {
    return Math.round(yuan * 100);
}

export function formatPrice(cents: number): string {
    return (cents / 100).toFixed(2);
}

export function applyDiscount(cents: number, percent: number): number {
    if (percent < 0 || percent > 100) throw new RangeError('折扣需在 0~100 之间');
    return Math.round((cents * (100 - percent)) / 100);
}
