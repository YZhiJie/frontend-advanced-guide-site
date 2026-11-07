// 文件: examples/22-11-sort-visualization.ts
// ============ 排序可视化：把每一次比较、交换、归位记录成「帧」 ============
// 可视化的本质不是画图，而是「让算法把中间状态交出来」：
//   每完成一个关键动作就 push 一帧 { values, active, sorted, msg }，
//   UI 只负责按帧回放，算法本身仍是纯函数、可单测、可换渲染器。
// 本示例实现冒泡 / 插入 / 快排 / 归并四种排序的埋点版本，并打印帧序列。
// 运行方式：npx tsx examples/22-11-sort-visualization.ts

interface Frame {
  values: number[];
  active: number[]; // 当前正在比较/交换的下标
  sorted: number[]; // 已确定最终位置的下标
  msg: string;
}

interface Traced {
  frames: Frame[];
  result: number[];
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(to - from, 0) }, (_, i) => from + i);

/** 冒泡：相邻逆序则交换；每轮把最大值推到末尾，可提前结束 */
function bubbleSort(input: number[]): Traced {
  const a = [...input];
  const frames: Frame[] = [];
  const mark = (active: number[], sorted: number[], msg: string): void => {
    frames.push({ values: [...a], active, sorted, msg });
  };
  mark([], [], `初始数组：[${a.join(", ")}]`);
  for (let i = 0; i < a.length - 1; i++) {
    let swapped = false;
    for (let j = 0; j < a.length - 1 - i; j++) {
      mark([j, j + 1], range(a.length - i, a.length), `比较 ${a[j]} 与 ${a[j + 1]}`);
      if (a[j] > a[j + 1]) {
        [a[j], a[j + 1]] = [a[j + 1], a[j]];
        mark([j, j + 1], range(a.length - i, a.length), `交换 → ${a[j]}, ${a[j + 1]}`);
        swapped = true;
      }
    }
    mark([], range(a.length - i - 1, a.length), `第 ${i + 1} 轮结束，下标 ${a.length - 1 - i} 归位`);
    if (!swapped) {
      mark([], range(0, a.length), "本轮无交换，数组已有序，提前结束");
      break;
    }
  }
  return { frames, result: a };
}

/** 插入：像理扑克牌，把当前牌插到左侧有序区的正确位置 */
function insertionSort(input: number[]): Traced {
  const a = [...input];
  const frames: Frame[] = [];
  const mark = (active: number[], msg: string): void => {
    frames.push({ values: [...a], active, sorted: [], msg });
  };
  mark([], `初始数组：[${a.join(", ")}]`);
  for (let i = 1; i < a.length; i++) {
    const current = a[i];
    let j = i - 1;
    mark([i], `取出 ${current}，准备插入左侧有序区`);
    while (j >= 0 && a[j] > current) {
      a[j + 1] = a[j];
      mark([j, j + 1], `${a[j]} 大于 ${current}，后移一位`);
      j--;
    }
    a[j + 1] = current;
    mark([j + 1], `${current} 落位下标 ${j + 1}`);
  }
  return { frames, result: a };
}

/** 快排：双指针分区；每一帧记录区间与基准归位 */
function quickSort(input: number[]): Traced {
  const a = [...input];
  const frames: Frame[] = [];
  const mark = (active: number[], msg: string): void => {
    frames.push({ values: [...a], active, sorted: [], msg });
  };
  const partition = (left: number, right: number): void => {
    if (left > right) return;
    if (left === right) {
      mark([left], `单元素 ${a[left]} 自然归位`);
      return;
    }
    const pivot = a[right];
    let i = left;
    let j = right - 1;
    mark([left, right], `分区 [${left}, ${right}]，基准 ${pivot}`);
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        [a[i], a[j]] = [a[j], a[i]];
        mark([i, j], `交换 ${a[j]} 与 ${a[i]}，继续向中间收缩`);
        i++;
        j--;
      }
    }
    [a[i], a[right]] = [a[right], a[i]];
    mark([i], `基准 ${pivot} 归位下标 ${i}`);
    partition(left, j);
    partition(i + 1, right);
  };
  partition(0, a.length - 1);
  return { frames, result: a };
}

/** 归并：自底向上两两合并，帧记录每次合并后的完整数组 */
function mergeSort(input: number[]): Traced {
  const a = [...input];
  const frames: Frame[] = [];
  const mark = (left: number, right: number, msg: string): void => {
    frames.push({ values: [...a], active: [left, Math.max(right - 1, left)], sorted: [], msg });
  };
  for (let width = 1; width < a.length; width *= 2) {
    for (let left = 0; left < a.length; left += width * 2) {
      const mid = Math.min(left + width, a.length);
      const right = Math.min(left + width * 2, a.length);
      const merged: number[] = [];
      let i = left;
      let j = mid;
      while (i < mid && j < right) merged.push(a[i] <= a[j] ? a[i++] : a[j++]);
      while (i < mid) merged.push(a[i++]);
      while (j < right) merged.push(a[j++]);
      for (let k = 0; k < merged.length; k++) a[left + k] = merged[k];
      mark(left, right, `合并 [${left}, ${mid}) 与 [${mid}, ${right})`);
    }
  }
  return { frames, result: a };
}

const input = [5, 2, 9, 1, 5, 6, 3, 8];

for (const [name, sorter] of [
  ["冒泡", bubbleSort],
  ["插入", insertionSort],
  ["快排", quickSort],
  ["归并", mergeSort],
] as const) {
  const { frames, result } = sorter(input);
  console.log(`\n=== ${name}排序（${frames.length} 帧）===`);
  for (const [i, f] of frames.entries()) {
    console.log(
      `#${String(i).padStart(2, "0")} [${f.values.join(",")}] 活跃[${f.active.join(",")}] ${f.msg}`,
    );
  }
  const expected = [...input].sort((x, y) => x - y);
  if (JSON.stringify(result) !== JSON.stringify(expected))
    throw new Error(`${name}排序结果错误：${result.join(",")}`);
  if (result.length !== input.length) throw new Error(`${name}排序丢元素`);
}

console.log("\n✓ 四种排序结果一致，帧序列可供 UI 回放");
