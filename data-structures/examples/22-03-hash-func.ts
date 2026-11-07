// 文件: data-structures/examples/22-03-hash-func.ts
// 对应 22.4.1：多项式滚动哈希与质数容量
import assert from "node:assert/strict";

function hashFunc(key: string, max: number): number {
  let hashCode = 0;
  for (let i = 0; i < key.length; i++) {
    hashCode = 31 * hashCode + key.charCodeAt(i); // 31 为底滚动累加
  }
  return hashCode % max; // 压缩到 [0, max) 下标范围
}

// 同一组键在质数容量 7 与合数容量 8 下的落桶情况
for (const key of ["abc", "cba", "hello"]) {
  console.log(`${key} → 容量 7: 桶 ${hashFunc(key, 7)}，容量 8: 桶 ${hashFunc(key, 8)}`);
}

assert.equal(hashFunc("abc", 7), 6);
assert.equal(hashFunc("cba", 7), 1);
// 合数容量 8 下 abc / cba 撞到同一个桶，质数 7 下被分开
assert.equal(hashFunc("abc", 8), hashFunc("cba", 8));
assert.notEqual(hashFunc("abc", 7), hashFunc("cba", 7));
// 任何键的结果都必须落在 [0, max)
for (const key of ["", "a", "hello", "前端"]) {
  const idx = hashFunc(key, 7);
  assert.ok(idx >= 0 && idx < 7);
}
console.log("✓ 22-03 哈希落桶断言全部通过");
