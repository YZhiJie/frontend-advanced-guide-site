// 文件: data-structures/examples/22-04-search-benchmark.ts
// 对应 22.1.2：顺序查找 vs 二分查找的微基准
import assert from "node:assert/strict";

/** 顺序查找：遍历数组，找到返回下标，没找到返回 -1 */
function sequentialSearch(nums: number[], target: number): number {
  for (let i = 0; i < nums.length; i++) if (nums[i] === target) return i;
  return -1;
}

/** 二分查找：仅针对有序序列 */
function binarySearch(nums: number[], target: number): number {
  let left = 0;
  let right = nums.length - 1;
  while (left <= right) {
    const mid = left + ((right - left) >> 1); // 防溢出写法，等价 floor((l+r)/2)
    if (nums[mid] === target) return mid;
    if (nums[mid] < target) left = mid + 1; // 目标在右半区
    else right = mid - 1; // 目标在左半区
  }
  return -1;
}

const N = 1_000_000;
const nums = Array.from({ length: N }, (_, i) => i); // 0~999999 有序数组
const target = N >> 1; // 找中间值，对顺序查找是最坏情况

assert.equal(sequentialSearch(nums, target), target);
assert.equal(binarySearch(nums, target), target);
assert.equal(binarySearch(nums, -1), -1);
assert.equal(binarySearch(nums, N), -1);

let start = performance.now();
sequentialSearch(nums, target);
const seqMs = performance.now() - start;
start = performance.now();
binarySearch(nums, target);
const binMs = performance.now() - start;

console.log("顺序查找耗时(ms)：", seqMs.toFixed(3));
console.log("二分查找耗时(ms)：", binMs.toFixed(3));
console.log("✓ 22-04 两种查找结果一致，二分显著更快");
