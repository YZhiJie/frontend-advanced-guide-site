// 文件: data-structures/examples/22-02-sliding-window.ts
// 对应 22.2.5：单调队列求滑动窗口最大值（LeetCode 239）
import assert from "node:assert/strict";

function maxSlidingWindow(nums: number[], k: number): number[] {
  if (k <= 0 || nums.length === 0) return [];
  const deque: number[] = []; // 存下标，对应值单调递减
  const result: number[] = []; // 每个窗口的最大值
  for (let i = 0; i < nums.length; i++) {
    // 队尾所有比当前值小的都弹出：当前元素更新、更大，它们再无出头之日
    while (deque.length > 0 && nums[i] >= nums[deque[deque.length - 1]]) deque.pop();
    deque.push(i);
    while (deque[0] <= i - k) deque.shift(); // 队头滑出窗口则移除
    if (i >= k - 1) result.push(nums[deque[0]]); // 窗口形成，队头即最大值
  }
  return result;
}

assert.deepEqual(maxSlidingWindow([1, 3, -1, -3, 5, 3, 6, 7], 3), [3, 3, 5, 5, 6, 7]);
assert.deepEqual(maxSlidingWindow([1], 1), [1]);
assert.deepEqual(maxSlidingWindow([9, 8, 7], 3), [9]);
assert.deepEqual(maxSlidingWindow([], 2), []);

// 演示：LeetCode 239 样例，窗口大小 k = 3
console.log(maxSlidingWindow([1, 3, -1, -3, 5, 3, 6, 7], 3)); // [3, 3, 5, 5, 6, 7]
console.log("✓ 22-02 单调队列断言全部通过");
