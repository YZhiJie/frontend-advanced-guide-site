// 文件: data-structures/examples/22-00-complexity-tier.ts
// 对应 22.1.1：用可运行代码对照 O(n) 与 O(n²)
import assert from "node:assert/strict";

/** O(n)：执行次数随 n 线性增长 */
function sum(arr: number[]): number {
  let total = 0;
  for (let i = 0; i < arr.length; i++) total += arr[i];
  return total;
}

/** O(n²)：两层嵌套，规模翻倍耗时变四倍 */
function hasDuplicate(arr: number[]): boolean {
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++)
      if (arr[i] === arr[j]) return true; // 比较次数 ≈ n(n-1)/2
  return false;
}

assert.equal(sum([1, 2, 3, 4]), 10);
assert.equal(hasDuplicate([1, 2, 3, 2]), true);
assert.equal(hasDuplicate([1, 2, 3, 4]), false);

console.log("sum([1, 2, 3, 4]) =", sum([1, 2, 3, 4])); // 10
console.log("hasDuplicate([1, 2, 3, 2]) =", hasDuplicate([1, 2, 3, 2])); // true
console.log("hasDuplicate([1, 2, 3, 4]) =", hasDuplicate([1, 2, 3, 4])); // false
console.log("✓ 22-00 复杂度分档断言全部通过");
