// 文件: examples/22-14-dp-visualization.ts
// ============ 动态规划可视化：把 dp 表的每一次写入记录成帧 ============
// DP 难在「看不见」：递归树指数展开、转移方程抽象。把 dp 表每个格子的
// 计算过程 emit 出来，状态定义、初始化、遍历顺序、返回值五步就都能被肉眼检查。
// 本示例覆盖 LIS（O(n²) 填表）、最大子数组和（滚动变量）、斐波那契（双变量）。
// 运行方式：npx tsx examples/22-14-dp-visualization.ts

interface DPFrame {
  row: number[]; // 当前数组
  dp: number[];
  i: number;
  j: number;
  msg: string;
}

/** 最长递增子序列：dp[i] = 以 nums[i] 结尾的最长长度 */
function lis(nums: number[]): { length: number; frames: DPFrame[] } {
  const dp = new Array<number>(nums.length).fill(1);
  const frames: DPFrame[] = [];
  const mark = (i: number, j: number, msg: string): void => {
    frames.push({ row: [...nums], dp: [...dp], i, j, msg });
  };
  mark(-1, -1, "初始化 dp 全为 1（每个元素自成长度 1）");
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < i; j++) {
      mark(i, j, `比较 nums[${j}]=${nums[j]} 与 nums[${i}]=${nums[i]}`);
      if (nums[j] < nums[i] && dp[j] + 1 > dp[i]) {
        dp[i] = dp[j] + 1;
        mark(i, j, `更新 dp[${i}] = ${dp[i]}（接到 dp[${j}] 后面）`);
      }
    }
  }
  return { length: Math.max(...dp), frames };
}

/** 最大子数组和：dp[i] = max(nums[i], dp[i-1] + nums[i])，只留一个滚动变量 */
function maxSubArray(nums: number[]): number {
  let prev = nums[0];
  let best = prev;
  for (let i = 1; i < nums.length; i++) {
    prev = Math.max(nums[i], prev + nums[i]);
    best = Math.max(best, prev);
  }
  return best;
}

/** 斐波那契：dp[i] 只依赖前两项，两个滚动变量 + 一次交换即可 O(1) 空间 */
function fib(n: number): number {
  let prev = 0;
  let current = 1;
  for (let i = 2; i <= n; i++) {
    const next = prev + current;
    prev = current;
    current = next;
  }
  return n === 0 ? 0 : current;
}

const nums = [10, 9, 2, 5, 3, 7, 101, 18];
const { length: lisLength, frames: lisFrames } = lis(nums);

console.log(`=== LIS 帧序列（${lisFrames.length} 帧）===`);
for (const [k, f] of lisFrames.entries()) {
  console.log(
    `#${String(k).padStart(2, "0")} dp=[${f.dp.join(",")}] 活跃(${f.i},${f.j}) ${f.msg}`,
  );
}

const maxFrame = lisFrames.filter((f) => f.i >= 0).at(-1)!;
console.log(`\n最终 dp=[${maxFrame.dp.join(", ")}]，LIS 长度 ${lisLength}`);

console.log("\n=== 最大子数组和 ===");
const sub = maxSubArray([-2, 1, -3, 4, -1, 2, 1, -5, 4]);
console.log("[-2,1,-3,4,-1,2,1,-5,4] →", sub);

console.log("\n=== 斐波那契（滚动变量）===");
console.log(
  "fib(0..10):",
  Array.from({ length: 11 }, (_, i) => fib(i)).join(", "),
);

if (lisLength !== 4) throw new Error(`LIS 长度应为 4，实际 ${lisLength}`);
if (sub !== 6) throw new Error(`最大子数组和应为 6，实际 ${sub}`);
if (fib(10) !== 55) throw new Error(`fib(10) 应为 55，实际 ${fib(10)}`);
if (lisFrames.length < 20) throw new Error("帧数过少，dp 过程没有被记录");

console.log("\n✓ LIS / 最大子数组 / 斐波那契结果正确，dp 帧可回放");
