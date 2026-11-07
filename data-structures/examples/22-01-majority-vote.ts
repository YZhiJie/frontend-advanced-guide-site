// 文件: data-structures/examples/22-01-majority-vote.ts
// 对应 22.1.4：同一问题的 O(n²) 与 O(n) 两种解法
import assert from "node:assert/strict";

/** 思路一：双层循环逐个统计 —— O(n²) 时间、O(1) 额外空间 */
function majorityBrute(nums: number[]): number | null {
  let best: number | null = null;
  let bestCount = 0;
  for (let i = 0; i < nums.length; i++) {
    let count = 0;
    for (let j = 0; j < nums.length; j++) if (nums[j] === nums[i]) count++;
    if (count > bestCount) {
      bestCount = count;
      best = nums[i];
    }
  }
  return best;
}

/** 思路二：一次扫描 + Map 计数 —— O(n) 时间、O(n) 空间（空间换时间） */
function majorityWithMap(nums: number[]): number | null {
  const freq = new Map<number, number>();
  let best: number | null = null;
  let bestCount = 0;
  for (const num of nums) {
    const next = (freq.get(num) ?? 0) + 1; // Map 读写均为 O(1)
    freq.set(num, next);
    if (next > bestCount) {
      bestCount = next;
      best = num;
    }
  }
  return best;
}

const demo = [2, 2, 1, 3, 2, 4, 2];
assert.equal(majorityBrute(demo), 2);
assert.equal(majorityWithMap(demo), 2);
assert.equal(majorityWithMap([]), null);

console.log("暴力解 =", majorityBrute(demo)); // 2
console.log("哈希解 =", majorityWithMap(demo)); // 2
console.log("✓ 22-01 两种解法结果一致");
