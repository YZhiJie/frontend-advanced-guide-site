// 文件: examples/03-01-modules/esm/counter.ts
// ============ ESM:值的"引用绑定"特性 ============

export let count = 0;

export function increment() {
    count++; // 修改的是导出绑定本身
}
