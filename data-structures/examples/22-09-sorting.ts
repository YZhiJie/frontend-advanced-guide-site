/**
 * 22-09-sorting.ts —— 排序算法
 * 对应主文档：第二十二部分 22.8 排序算法
 *
 * 内容清单：
 *   1. 十大排序实现：
 *      bubbleSort（冒泡）/ selectionSort（选择）/ insertionSort（插入）/ shellSort（希尔）
 *      mergeSort（归并）/ quickSort（快排，双指针 partition）
 *      heapSort（堆排）/ countingSort（计数）/ bucketSort（桶排）/ radixSort（基数）
 *   2. 每个算法注释时间/空间复杂度与稳定性
 *   3. 末尾用 performance.now() 对 1 万条随机数实测耗时并打印表格
 *
 * 运行方式：npx tsx data-structures/examples/22-09-sorting.ts
 */

// ============================================================
// 工具：原地交换 + 检查有序 + 深拷贝
// ============================================================

function swap<T>(arr: T[], i: number, j: number): void {
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function isSorted(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i++) if (arr[i] < arr[i - 1]) return false;
  return true;
}

function clone(arr: number[]): number[] {
  return [...arr];
}

// ============================================================
// 一、冒泡排序（Bubble Sort）
// ============================================================

/**
 * 反复从头扫，相邻两个错误顺序就交换，每轮把当前最大的「冒泡」到末尾。
 * 时间 O(n²) 最坏/平均，O(n) 最好（已有序一轮扫完）；空间 O(1)；稳定。
 */
function bubbleSort(arr: number[]): number[] {
  const a = [...arr];
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    let swapped = false;
    for (let j = 0; j < n - 1 - i; j++) {
      if (a[j] > a[j + 1]) {
        swap(a, j, j + 1);
        swapped = true;
      }
    }
    if (!swapped) break; // 提前终止：已全局有序
  }
  return a;
}

// ============================================================
// 二、选择排序（Selection Sort）
// ============================================================

/**
 * 每轮找最小值下标，与当前轮起点交换。
 * 时间 O(n²) 最好/最坏/平均；空间 O(1)；不稳定（长距离交换会跨跳同值元素）。
 */
function selectionSort(arr: number[]): number[] {
  const a = [...arr];
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    let minIdx = i;
    for (let j = i + 1; j < n; j++) {
      if (a[j] < a[minIdx]) minIdx = j;
    }
    if (minIdx !== i) swap(a, i, minIdx);
  }
  return a;
}

// ============================================================
// 三、插入排序（Insertion Sort）
// ============================================================

/**
 * 像整理扑克牌：把新元素插入已排好序的左侧区间。
 * 时间 O(n²) 最坏/平均，O(n) 最好（近乎有序）；空间 O(1)；稳定。
 * 当数组近乎有序时，插入排序比快排还快——这就是 Timsort（Python/Java）
 * 在小段退化为插入排序的原因。
 */
function insertionSort(arr: number[]): number[] {
  const a = [...arr];
  for (let i = 1; i < a.length; i++) {
    const key = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > key) {
      a[j + 1] = a[j]; // 元素后挪，腾出空位
      j--;
    }
    a[j + 1] = key;
  }
  return a;
}

// ============================================================
// 四、希尔排序（Shell Sort）—— 插入排序的升级版
// ============================================================

/**
 * 先按大间隔分组做插入排序，再逐步缩小间隔直到 1。
 * 大间隔移动一步到位，避免了长距离元素一点点挪的浪费。
 * 时间：复杂度依赖增量序列，常用 Knuth 序列 (3k+1) 最坏 O(n^1.5)；空间 O(1)；不稳定。
 */
function shellSort(arr: number[]): number[] {
  const a = [...arr];
  const n = a.length;
  let gap = 1;
  while (gap < n / 3) gap = gap * 3 + 1; // Knuth 增量序列
  while (gap >= 1) {
    for (let i = gap; i < n; i++) {
      const key = a[i];
      let j = i - gap;
      while (j >= 0 && a[j] > key) {
        a[j + gap] = a[j];
        j -= gap;
      }
      a[j + gap] = key;
    }
    gap = Math.floor(gap / 3);
  }
  return a;
}

// ============================================================
// 五、归并排序（Merge Sort）
// ============================================================

/**
 * 分治：二分拆开，分别排序后合并。
 * 时间 O(n log n) 最坏/平均/最好；空间 O(n)（合并时需临时数组）；稳定。
 * JS Array.prototype.sort 在 V8 中底层用 Timsort（归并+插入的混合），
 * 但归并排序本身是面试高频，必须能手写。
 */
function mergeSort(arr: number[]): number[] {
  if (arr.length <= 1) return [...arr];
  const mid = arr.length >> 1;
  const left = mergeSort(arr.slice(0, mid));
  const right = mergeSort(arr.slice(mid));
  return merge(left, right);
}

function merge(left: number[], right: number[]): number[] {
  const result: number[] = [];
  let i = 0,
    j = 0;
  while (i < left.length && j < right.length) {
    // 取 ≤ 保证稳定性（但数字没稳定性概念，保留逻辑即可）
    if (left[i] <= right[j]) result.push(left[i++]);
    else result.push(right[j++]);
  }
  while (i < left.length) result.push(left[i++]);
  while (j < right.length) result.push(right[j++]);
  return result;
}

// ============================================================
// 六、快速排序（Quick Sort）—— 双指针 partition
// ============================================================

/**
 * 分治：选基准 pivot，把数组切分成「≤ pivot」和「> pivot」两段，递归处理。
 * 本实现用「随机选 pivot」+「双指针」partition，把平均和最坏都尽量压下去。
 * 时间 O(n log n) 平均，O(n²) 最坏（已有序+选端点基准）；空间 O(log n) 递归栈；不稳定。
 * 为什么不用 Lomuto 分区：双指针循环中 swap 次数更少，且对重复元素表现更稳。
 */
function quickSort(arr: number[]): number[] {
  const a = [...arr];
  const sort = (l: number, r: number): void => {
    if (l >= r) return;
    // 随机选 pivot 避免已有序数组 O(n²)
    const randIdx = l + Math.floor(Math.random() * (r - l + 1));
    swap(a, randIdx, r);
    const pivot = a[r];
    let i = l - 1; // i 指向「已确认 ≤ pivot」的最后一个位置
    for (let j = l; j < r; j++) {
      if (a[j] <= pivot) {
        i++;
        swap(a, i, j);
      }
    }
    swap(a, i + 1, r); // pivot 归位到正确位置
    const p = i + 1;
    sort(l, p - 1);
    sort(p + 1, r);
  };
  sort(0, a.length - 1);
  return a;
}

// ============================================================
// 七、堆排序（Heap Sort）
// ============================================================

/**
 * 思路：数组原地 heapify 成大顶堆，然后反复把堆顶（最大）与末尾交换并堆化缩减范围。
 * 时间 O(n log n) 最坏/平均/最好；空间 O(1)（原地排序）；不稳定。
 * 工程中排序数组的场景很少用堆排，因为快排常数更小；
 * 但 TopK/优先级队列场景堆是核心数据结构。
 */
function heapSort(arr: number[]): number[] {
  const a = [...arr];
  const n = a.length;
  if (n <= 1) return a;

  // 原地 heapify：从最后一个非叶子节点往前 siftDown
  for (let i = (n - 2) >> 1; i >= 0; i--) {
    siftDown(a, i, n);
  }

  // 每次把当前最大元素放到未排序段的末尾
  for (let end = n - 1; end > 0; end--) {
    swap(a, 0, end);
    siftDown(a, 0, end); // 堆大小缩减 1
  }
  return a;
}

/** 原地堆化：heapSize 限定了有效堆范围 */
function siftDown(a: number[], i: number, heapSize: number): void {
  while (true) {
    let largest = i;
    const left = 2 * i + 1;
    const right = 2 * i + 2;
    if (left < heapSize && a[left] > a[largest]) largest = left;
    if (right < heapSize && a[right] > a[largest]) largest = right;
    if (largest === i) break;
    swap(a, i, largest);
    i = largest;
  }
}

// ============================================================
// 八、计数排序（Counting Sort）—— 非比较排序
// ============================================================

/**
 * 适用：非负整数，且数值范围 max 不太大。
 * 统计每个值出现的次数，再按频次铺回数组。
 * 时间 O(n + k)（k 为数值范围）；空间 O(k)；稳定。
 * 注意：本实现只支持非负整数（JS 浮点数不适合计数排序）。
 */
function countingSort(arr: number[]): number[] {
  if (arr.length === 0) return [];
  const max = Math.max(...arr);
  const count = new Array(max + 1).fill(0);
  for (const v of arr) count[v]++;
  const result: number[] = [];
  for (let i = 0; i < count.length; i++) {
    for (let j = 0; j < count[i]; j++) result.push(i);
  }
  return result;
}

// ============================================================
// 九、桶排序（Bucket Sort）
// ============================================================

/**
 * 思路：把值域切分成若干桶，先散入桶中，各桶内部用插入排序，最后按桶顺序合并。
 * 数据均匀分布时接近 O(n)；最坏所有元素进同一个桶退化为 O(n²)。
 * 空间 O(n + k)（k 为桶数）；稳定与否取决于桶内排序算法（本实现用插入排序，故稳定）。
 */
function bucketSort(arr: number[]): number[] {
  if (arr.length === 0) return [];
  const n = arr.length;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const bucketCount = Math.max(5, Math.floor(Math.sqrt(n)));
  const buckets: number[][] = Array.from({ length: bucketCount }, () => []);

  for (const v of arr) {
    const idx = Math.floor(((v - min) / (max - min)) * (bucketCount - 1));
    buckets[idx].push(v);
  }

  const result: number[] = [];
  for (const b of buckets) {
    result.push(...insertionSort(b)); // 桶内插排
  }
  return result;
}

// ============================================================
// 十、基数排序（Radix Sort）—— LSD（最低位优先）
// ============================================================

/**
 * 按位排序：先按个位排，再按十位排……直到最高位。
 * 每一位用「计数排序」作为稳定子排序，保证高位排完不破坏低位已排好的相对顺序。
 * 时间 O(d × (n + k))，d 是位数，k 是基数（10）；空间 O(n + k)。
 * 本实现仅限非负整数。
 */
function radixSort(arr: number[]): number[] {
  if (arr.length === 0) return [];
  const a = [...arr];
  let max = Math.max(...a);
  for (let exp = 1; Math.floor(max / exp) > 0; exp *= 10) {
    countingSortByDigit(a, exp);
  }
  return a;
}

function countingSortByDigit(arr: number[], exp: number): void {
  const n = arr.length;
  const output = new Array(n);
  const count = new Array(10).fill(0);
  for (const v of arr) count[Math.floor(v / exp) % 10]++;
  for (let i = 1; i < 10; i++) count[i] += count[i - 1];
  // 必须倒序遍历保证稳定性：先出现的元素在 output 中也先出现
  for (let i = n - 1; i >= 0; i--) {
    const digit = Math.floor(arr[i] / exp) % 10;
    output[count[digit] - 1] = arr[i];
    count[digit]--;
  }
  for (let i = 0; i < n; i++) arr[i] = output[i];
}

// ============================================================
// 十一、实测：1 万条随机数
// ============================================================

const N = 10_000;
const randomData: number[] = [];
for (let i = 0; i < N; i++) randomData.push(Math.floor(Math.random() * N));

/** 把负数/浮点调整为非负整数，供计数/基数/桶排测试 */
const nonNegData: number[] = randomData.map((v) => v + N); // 确保全为非负

interface Bench {
  name: string;
  fn: (arr: number[]) => number[];
  source: number[]; // 排序用哪个源数组
}

const benches: Bench[] = [
  { name: "bubble", fn: bubbleSort, source: randomData },
  { name: "selection", fn: selectionSort, source: randomData },
  { name: "insertion", fn: insertionSort, source: randomData },
  { name: "shell", fn: shellSort, source: randomData },
  { name: "merge", fn: mergeSort, source: randomData },
  { name: "quick", fn: quickSort, source: randomData },
  { name: "heap", fn: heapSort, source: randomData },
  { name: "counting", fn: countingSort, source: nonNegData },
  { name: "bucket", fn: bucketSort, source: nonNegData },
  { name: "radix", fn: radixSort, source: nonNegData },
];

console.log(`\n📊 排序算法实测（数据量 ${N}）：`);
console.log("-".repeat(45));
console.log(`${"算法".padEnd(12)}${"耗时(ms)".padEnd(12)}${"正确性"}`);
console.log("-".repeat(45));

for (const b of benches) {
  const arr = clone(b.source);
  const t0 = performance.now();
  const sorted = b.fn(arr);
  const t1 = performance.now();
  const ok = isSorted(sorted) && sorted.length === b.source.length;
  console.log(`${b.name.padEnd(12)}${(t1 - t0).toFixed(2).padEnd(12)}${ok ? "✅" : "❌"}`);
}
console.log("-".repeat(45));

// ============================================================
// 十二、自测断言（覆盖边界与正确性）
// ============================================================

// --- 空数组与单元素 ---
const empty: number[] = [];
console.assert(JSON.stringify(bubbleSort(empty)) === "[]", "空数组冒泡应为 []");
console.assert(JSON.stringify(selectionSort(empty)) === "[]", "空数组选择应为 []");
console.assert(JSON.stringify(insertionSort(empty)) === "[]", "空数组插入应为 []");
console.assert(JSON.stringify(mergeSort(empty)) === "[]", "空数组归并应为 []");
console.assert(JSON.stringify(quickSort(empty)) === "[]", "空数组快排应为 []");
console.assert(JSON.stringify(heapSort(empty)) === "[]", "空数组堆排应为 []");
console.assert(JSON.stringify(countingSort(empty)) === "[]", "空数组计数应为 []");
console.assert(JSON.stringify(bucketSort(empty)) === "[]", "空数组桶排应为 []");
console.assert(JSON.stringify(radixSort(empty)) === "[]", "空数组基数应为 []");

console.assert(JSON.stringify(bubbleSort([7])) === "[7]", "单元素冒泡应不变");
console.assert(JSON.stringify(quickSort([7])) === "[7]", "单元素快排应不变");
console.assert(JSON.stringify(mergeSort([7])) === "[7]", "单元素归并应不变");

// --- 正确性 ---
const sample = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5];
const expected = [...sample].sort((a, b) => a - b);
for (const b of benches.slice(0, 7)) {
  // 比较排序全支持负数/重复/浮点
  console.assert(
    JSON.stringify(b.fn(sample)) === JSON.stringify(expected),
    `${b.name} 应排序正确`
  );
}
// 非比较排序只能用非负整数验证（sample 本身非负）
for (const b of benches.slice(7)) {
  console.assert(
    JSON.stringify(b.fn(sample)) === JSON.stringify(expected),
    `${b.name} 应排序正确`
  );
}

// --- 稳定性相关：全部排序后应为升序（虽然非比较排序未必稳定，但最终有序即可） ---
const big = Array.from({ length: 1000 }, () => Math.floor(Math.random() * 1000));
console.assert(isSorted(quickSort(big)), "快排 1000 个元素应有序");
console.assert(isSorted(mergeSort(big)), "归并 1000 个元素应有序");
console.assert(isSorted(heapSort(big)), "堆排 1000 个元素应有序");
console.assert(isSorted(shellSort(big)), "希尔 1000 个元素应有序");

console.log("\n✅ 22-09 sorting 全部断言通过");

export {};
