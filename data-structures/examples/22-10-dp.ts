/**
 * 22-10-dp.ts —— 动态规划（Dynamic Programming）
 * 对应主文档：第二十二部分 22.9 动态规划入门
 *
 * 内容清单：
 *   1. 斐波那契四解：纯递归 / 记忆化 Map / DP 数组 / 状态压缩 O(1) 空间
 *   2. 跳台阶（LeetCode 70 爬楼梯同款）
 *   3. 买卖股票一次交易（LeetCode 121，DP + 状态压缩）
 *   4. 最大子数组和（LeetCode 53，Kadane，含 dp 数组打印过程）
 *   5. 最长递增子序列 LIS 双解（LeetCode 300：DP O(n²) 与 贪心+二分 O(n log n)）
 *
 * 运行方式：npx tsx data-structures/examples/22-10-dp.ts
 */

// ============================================================
// 一、斐波那契四解
// ============================================================

/**
 * 解法 1：纯递归
 * 时间 O(2^n)——f(n) 展开成二叉递归树，大量子问题被重复计算；
 * 空间 O(n)（递归栈深度）。n=40 以上就会肉眼可见地卡。
 */
function fibRecursive(n: number): number {
  if (n <= 1) return n;
  return fibRecursive(n - 1) + fibRecursive(n - 2);
}

/**
 * 解法 2：记忆化递归（自顶向下）
 * 用 Map 缓存已算过的子问题，每个 n 只算一次。
 * 时间 O(n)，空间 O(n)（缓存 + 递归栈）。
 */
function fibMemo(n: number): number {
  const memo = new Map<number, number>();
  const dfs = (k: number): number => {
    if (k <= 1) return k;
    const cached = memo.get(k);
    if (cached !== undefined) return cached; // 命中缓存，剪掉整棵子树
    const result = dfs(k - 1) + dfs(k - 2);
    memo.set(k, result);
    return result;
  };
  return dfs(n);
}

/**
 * 解法 3：DP 数组（自底向上）
 * 状态定义：dp[i] = 第 i 个斐波那契数
 * 状态转移：dp[i] = dp[i-1] + dp[i-2]
 * 时间 O(n)，空间 O(n)。消除了递归开销，是教科书写法。
 */
function fibDP(n: number): number {
  if (n <= 1) return n;
  const dp = new Array<number>(n + 1);
  dp[0] = 0;
  dp[1] = 1;
  for (let i = 2; i <= n; i++) {
    dp[i] = dp[i - 1] + dp[i - 2];
  }
  return dp[n];
}

/**
 * 解法 4：状态压缩（滚动变量）
 * 观察转移方程：dp[i] 只依赖前两项，整个 dp 数组是浪费。
 * 两个变量滚动即可。时间 O(n)，空间 O(1)——最优解。
 */
function fibCompressed(n: number): number {
  if (n <= 1) return n;
  let prev = 0;
  let curr = 1;
  for (let i = 2; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }
  return curr;
}

// ============================================================
// 二、跳台阶（LeetCode 70 爬楼梯）
// ============================================================

/**
 * 每次能跳 1 或 2 级，跳到 n 级有多少种跳法？
 * 状态定义：dp[i] = 跳到第 i 级的方法数
 * 状态转移：最后一步要么从 i-1 跳 1 级，要么从 i-2 跳 2 级 → dp[i] = dp[i-1] + dp[i-2]
 * 其实就是位移了一位的斐波那契。
 * 时间 O(n)，状态压缩后空间 O(1)。
 */
function climbStairs(n: number): number {
  if (n <= 2) return n;
  let prev = 1; // dp[1]
  let curr = 2; // dp[2]
  for (let i = 3; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }
  return curr;
}

// ============================================================
// 三、买卖股票一次交易（LeetCode 121）
// ============================================================

/**
 * 只许买卖一次，求最大收益。
 * DP 解法：
 *   dp[i][0] = 第 i 天结束时「不持股」的最大利润
 *   dp[i][1] = 第 i 天结束时「持股」的最大利润
 *   转移：
 *     dp[i][0] = max(dp[i-1][0], dp[i-1][1] + prices[i])  // 昨天就不持有，或今天卖出
 *     dp[i][1] = max(dp[i-1][1], -prices[i])              // 昨天就持有，或今天买入
 * 观察：每天只依赖前一天 → 状态压缩成两个变量。
 * 时间 O(n)，空间 O(1)。
 */
function maxProfit(prices: number[]): number {
  if (prices.length === 0) return 0;
  let hold = -prices[0]; // 持股状态的最大利润（买入后为负）
  let cash = 0; // 不持股状态的最大利润
  for (let i = 1; i < prices.length; i++) {
    cash = Math.max(cash, hold + prices[i]); // 卖或不卖
    hold = Math.max(hold, -prices[i]); // 买或继续持有
  }
  return cash; // 最后一天必然不持股更优
}

// ============================================================
// 四、最大子数组和（LeetCode 53，Kadane 算法）
// ============================================================

/**
 * 状态定义：dp[i] = 以 nums[i] 结尾的最大子数组和
 * 状态转移：dp[i] = max(nums[i], dp[i-1] + nums[i])
 *   —— 要么「自立门户」从 nums[i] 重新开始，要么「并入前段」。
 *   为什么可以这么狠：如果 dp[i-1] 是负数，带上它只会拖后腿。
 * 答案 = max(dp)。返回 { maxSum, dpTrace } 便于打印推导过程。
 */
function maxSubArray(nums: number[]): { maxSum: number; dpTrace: number[] } {
  const dp = new Array<number>(nums.length);
  dp[0] = nums[0];
  let maxSum = dp[0];
  for (let i = 1; i < nums.length; i++) {
    dp[i] = Math.max(nums[i], dp[i - 1] + nums[i]);
    maxSum = Math.max(maxSum, dp[i]);
  }
  return { maxSum, dpTrace: dp };
}

// ============================================================
// 五、最长递增子序列 LIS（LeetCode 300）
// ============================================================

/**
 * 解法 1：经典 DP，O(n²)
 * 状态定义：dp[i] = 以 nums[i] 结尾的最长递增子序列长度
 * 状态转移：枚举所有 j < i，若 nums[j] < nums[i] 则 dp[i] = max(dp[i], dp[j] + 1)
 * 时间 O(n²)，空间 O(n)。
 */
function lengthOfLIS_DP(nums: number[]): number {
  if (nums.length === 0) return 0;
  const dp = new Array<number>(nums.length).fill(1); // 每个元素自身构成长度 1 的 LIS
  let best = 1;
  for (let i = 1; i < nums.length; i++) {
    for (let j = 0; j < i; j++) {
      if (nums[j] < nums[i]) {
        dp[i] = Math.max(dp[i], dp[j] + 1);
      }
    }
    best = Math.max(best, dp[i]);
  }
  return best;
}

/**
 * 解法 2：贪心 + 二分，O(n log n)
 * 维护数组 tails：tails[k] = 长度为 k+1 的递增子序列中，最小的结尾元素。
 * 为什么 tails 天然递增：长度更长的 LIS 结尾一定 ≥ 更短的结尾（否则更长的那条不成立）。
 * 对每个 num 在 tails 里二分找「第一个 ≥ num 的位置」替换掉——
 * 让相同长度的 LIS 结尾尽量小，给后面留出更多延长空间（贪心核心）。
 * 找不到（num 比所有结尾都大）就追加，LIS 长度 +1。
 */
function lengthOfLIS_Greedy(nums: number[]): number {
  const tails: number[] = [];
  for (const num of nums) {
    // 手写二分：找 tails 中第一个 >= num 的下标
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < num) lo = mid + 1;
      else hi = mid;
    }
    if (lo === tails.length) tails.push(num); // 全部小于 num，延长
    else tails[lo] = num; // 替换，压低该长度的结尾
  }
  return tails.length; // tails 的长度即 LIS 长度（内容不一定是真实 LIS）
}

// ============================================================
// 六、自测断言
// ============================================================

// --- 斐波那契四解一致性 ---
const fibExpect = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
for (let i = 0; i < fibExpect.length; i++) {
  console.assert(fibRecursive(i) === fibExpect[i], `纯递归 fib(${i}) 应为 ${fibExpect[i]}`);
  console.assert(fibMemo(i) === fibExpect[i], `记忆化 fib(${i}) 应为 ${fibExpect[i]}`);
  console.assert(fibDP(i) === fibExpect[i], `DP 数组 fib(${i}) 应为 ${fibExpect[i]}`);
  console.assert(fibCompressed(i) === fibExpect[i], `状态压缩 fib(${i}) 应为 ${fibExpect[i]}`);
}
// 大 n 验证：四解（除纯递归外）应快速一致
console.assert(fibMemo(50) === 12586269025, "记忆化 fib(50) 应为 12586269025");
console.assert(fibDP(50) === 12586269025, "DP 数组 fib(50) 应一致");
console.assert(fibCompressed(50) === 12586269025, "状态压缩 fib(50) 应一致");
console.assert(fibRecursive(0) === 0 && fibRecursive(1) === 1, "纯递归边界");

// --- 跳台阶 ---
console.assert(climbStairs(1) === 1, "1 级台阶只有 1 种跳法");
console.assert(climbStairs(2) === 2, "2 级台阶有 2 种跳法");
console.assert(climbStairs(3) === 3, "3 级台阶有 3 种跳法");
console.assert(climbStairs(10) === 89, "10 级台阶应为 89 种跳法");
console.assert(climbStairs(20) === 10946, "20 级台阶应为 10946 种跳法");

// --- 买卖股票 ---
console.assert(maxProfit([7, 1, 5, 3, 6, 4]) === 5, "LeetCode 121 样例一：1 买 6 卖，利润 5");
console.assert(maxProfit([7, 6, 4, 3, 1]) === 0, "一路下跌应不交易，利润 0");
console.assert(maxProfit([]) === 0, "空数组利润 0");
console.assert(maxProfit([5]) === 0, "只有一天无法交易，利润 0");
console.assert(maxProfit([1, 2]) === 1, "两天上涨利润 1");
console.assert(maxProfit([2, 1]) === 0, "两天下跌不交易");

// --- 最大子数组和（Kadane）---
const kadane = maxSubArray([-2, 1, -3, 4, -1, 2, 1, -5, 4]);
console.assert(kadane.maxSum === 6, "LeetCode 53 样例：子数组 [4,-1,2,1] 和为 6");
console.log(`🔍 Kadane dp 推导过程：${kadane.dpTrace.join(" -> ")}`);
console.assert(
  JSON.stringify(kadane.dpTrace) === JSON.stringify([-2, 1, -2, 4, 3, 5, 6, 1, 5]),
  "dp 数组应记录每个位置的结尾最大和"
);
console.assert(maxSubArray([1]).maxSum === 1, "单元素最大和即自身");
console.assert(maxSubArray([-3, -1, -2]).maxSum === -1, "全负数时应取最大的那个单元素");
console.assert(maxSubArray([5, 4, -1, 7, 8]).maxSum === 23, "全正数组和为总和");

// --- LIS 双解 ---
const lis1 = [10, 9, 2, 5, 3, 7, 101, 18];
console.assert(lengthOfLIS_DP(lis1) === 4, "DP 解：LIS 长度应为 4（[2,3,7,101]）");
console.assert(lengthOfLIS_Greedy(lis1) === 4, "贪心二分解：结果应与 DP 一致");
const lis2 = [0, 1, 0, 3, 2, 3];
console.assert(lengthOfLIS_DP(lis2) === 4 && lengthOfLIS_Greedy(lis2) === 4, "重复元素场景两解应一致");
console.assert(lengthOfLIS_DP([7, 7, 7, 7]) === 1, "严格递增下全同元素 LIS 应为 1");
console.assert(lengthOfLIS_Greedy([7, 7, 7, 7]) === 1, "贪心解同应处理重复元素");
console.assert(lengthOfLIS_DP([]) === 0 && lengthOfLIS_Greedy([]) === 0, "空数组 LIS 应为 0");
console.assert(lengthOfLIS_DP([3]) === 1 && lengthOfLIS_Greedy([3]) === 1, "单元素 LIS 应为 1");
// 两解对拍：随机数组结果必须一致
let seed = 7;
const rand = (): number => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};
for (let t = 0; t < 20; t++) {
  const arr = Array.from({ length: 20 }, () => Math.floor(rand() * 50));
  console.assert(
    lengthOfLIS_DP(arr) === lengthOfLIS_Greedy(arr),
    `对拍第 ${t} 组：两种 LIS 解法结果必须一致`
  );
}

console.log("✅ 22-10 dp 全部断言通过");

export {};
