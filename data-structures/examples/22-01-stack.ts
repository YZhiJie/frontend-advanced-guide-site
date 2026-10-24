/**
 * 22-01-stack.ts —— 栈（Stack）
 * 对应主文档：第二十二部分 22.2 栈与队列
 *
 * 内容清单：
 *   1. IStack<T> 接口 + ArrayStack<T> 泛型类（push / pop / peek / isEmpty / size）
 *   2. 应用一：有效括号匹配
 *   3. 应用二：十进制转二进制
 *   4. 应用三：逆波兰表达式（后缀表达式）求值
 *   5. 应用四：浏览器前进 / 后退双栈模拟
 *
 * 运行方式：npx tsx data-structures/examples/22-01-stack.ts
 */

// ============================================================
// 一、栈的封装
// ============================================================

/** 栈的抽象接口：只允许在栈顶操作，LIFO（后进先出） */
interface IStack<T> {
  push(element: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
  isEmpty(): boolean;
  size(): number;
}

/**
 * 基于数组的栈实现。
 * 为什么用数组而不是链表：JS 数组的 push/pop 是摊还 O(1)，
 * 且内存连续、缓存友好，是栈的最优底层结构。
 */
class ArrayStack<T> implements IStack<T> {
  // private 封装：栈的正确性依赖「只能动栈顶」，必须挡住外部随意按下标访问
  private data: T[] = [];

  push(element: T): void {
    this.data.push(element);
  }

  pop(): T | undefined {
    // 空栈时 pop 返回 undefined，而不是抛异常——让调用方自行决定空栈语义
    return this.data.pop();
  }

  peek(): T | undefined {
    return this.data[this.data.length - 1];
  }

  isEmpty(): boolean {
    return this.data.length === 0;
  }

  size(): number {
    return this.data.length;
  }
}

// ============================================================
// 二、应用一：有效括号匹配（LeetCode 20）
// ============================================================

/**
 * 思路：遇到左括号入栈；遇到右括号时栈顶必须是对应的左括号，否则不合法。
 * 为什么用栈：括号是「最近未闭合的先闭合」结构，天然 LIFO。
 */
function isValidBrackets(s: string): boolean {
  const stack = new ArrayStack<string>();
  // 用 Map 存配对关系，查「右括号期望的左括号」是 O(1)
  const pairs = new Map<string, string>([
    [")", "("],
    ["]", "["],
    ["}", "{"],
  ]);

  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(ch);
    } else if (pairs.has(ch)) {
      // 右括号出现时栈不能为空，且栈顶必须与之配对
      if (stack.isEmpty() || stack.pop() !== pairs.get(ch)) {
        return false;
      }
    }
    // 其他字符直接忽略（实际面试可约定只含括号）
  }
  // 全部扫完后栈必须为空——说明每个左括号都被闭合了
  return stack.isEmpty();
}

// ============================================================
// 三、应用二：十进制转二进制
// ============================================================

/**
 * 短除法：不断除 2 取余，余数倒序排列即二进制。
 * 「倒序」正好用栈实现——先算出的低位后输出。
 */
function decimalToBinary(n: number): string {
  if (n === 0) return "0"; // 边界：0 的循环不执行，单独处理
  const stack = new ArrayStack<number>();
  let num = n;
  while (num > 0) {
    stack.push(num % 2); // 余数（当前最低位）先入栈
    num = Math.floor(num / 2);
  }
  let binary = "";
  while (!stack.isEmpty()) {
    binary += stack.pop(); // 出栈顺序 = 从高位到低位
  }
  return binary;
}

// ============================================================
// 四、应用三：逆波兰表达式（后缀表达式）求值（LeetCode 150）
// ============================================================

/**
 * 思路：数字入栈；遇到运算符弹出两个操作数计算，结果再入栈。
 * 注意弹栈顺序：先弹出的是右操作数（b），后弹出的是左操作数（a）。
 * 为什么适合用栈：后缀表达式无需括号，运算优先级由位置天然决定。
 */
function evalRPN(tokens: string[]): number {
  const stack = new ArrayStack<number>();
  for (const token of tokens) {
    if (token === "+" || token === "-" || token === "*" || token === "/") {
      const b = stack.pop()!; // 右操作数（后入栈，先出栈）
      const a = stack.pop()!; // 左操作数
      switch (token) {
        case "+":
          stack.push(a + b);
          break;
        case "-":
          stack.push(a - b);
          break;
        case "*":
          stack.push(a * b);
          break;
        case "/":
          // LeetCode 约定向零取整；JS 的 / 是浮点除法，需手动截断
          stack.push(Math.trunc(a / b));
          break;
      }
    } else {
      stack.push(Number(token));
    }
  }
  return stack.pop()!;
}

// ============================================================
// 五、应用四：浏览器前进 / 后退（双栈模拟）
// ============================================================

/**
 * 经典双栈模型：
 *   backStack    —— 当前页左侧的历史（可「后退」的页面）
 *   forwardStack —— 当前页右侧的历史（可「前进」的页面）
 * visit 新页面时 forwardStack 必须清空——这是真实浏览器的行为：
 * 一旦从中间分支访问新地址，「前进」路径就被废弃了。
 */
class BrowserHistory {
  private backStack = new ArrayStack<string>();
  private forwardStack = new ArrayStack<string>();
  private current: string;

  constructor(homepage: string) {
    this.current = homepage;
  }

  visit(url: string): void {
    this.backStack.push(this.current); // 旧页入后退栈
    this.current = url;
    // 关键：访问新页面后，「前进」栈作废
    this.forwardStack = new ArrayStack<string>();
  }

  back(): string {
    if (this.backStack.isEmpty()) return this.current; // 不能再退
    this.forwardStack.push(this.current); // 当前页转入前进栈
    this.current = this.backStack.pop()!;
    return this.current;
  }

  forward(): string {
    if (this.forwardStack.isEmpty()) return this.current; // 不能再进
    this.backStack.push(this.current);
    this.current = this.forwardStack.pop()!;
    return this.current;
  }

  getCurrent(): string {
    return this.current;
  }
}

// ============================================================
// 六、自测断言
// ============================================================

// --- ArrayStack 基础功能 ---
const st = new ArrayStack<number>();
console.assert(st.isEmpty() && st.size() === 0, "新栈应为空");
console.assert(st.pop() === undefined, "空栈 pop 应返回 undefined");
console.assert(st.peek() === undefined, "空栈 peek 应返回 undefined");
st.push(1);
st.push(2);
st.push(3);
console.assert(st.size() === 3, "push 三个元素后 size 应为 3");
console.assert(st.peek() === 3, "peek 应看到最后入栈的 3");
console.assert(
  st.pop() === 3 && st.pop() === 2 && st.pop() === 1,
  "出栈顺序应为 3-2-1（LIFO）",
);
console.assert(st.isEmpty(), "全部弹出后应为空");

// --- 有效括号 ---
console.assert(isValidBrackets("()[]{}") === true, "全部配对应合法");
console.assert(isValidBrackets("([{}])") === true, "嵌套配对应合法");
console.assert(isValidBrackets("(]") === false, "交叉括号应非法");
console.assert(isValidBrackets("([)]") === false, "错位嵌套应非法");
console.assert(isValidBrackets("(") === false, "单个左括号未闭合应非法");
console.assert(isValidBrackets(")") === false, "单个右括号应非法");
console.assert(isValidBrackets("") === true, "空串视为合法");

// --- 十进制转二进制 ---
console.assert(decimalToBinary(0) === "0", "0 的二进制应为 '0'");
console.assert(decimalToBinary(1) === "1", "1 的二进制应为 '1'");
console.assert(decimalToBinary(10) === "1010", "10 的二进制应为 '1010'");
console.assert(
  decimalToBinary(233) === (233).toString(2),
  "应与原生 toString(2) 一致",
);
console.assert(
  decimalToBinary(1024) === "10000000000",
  "2 的幂应为 1 后跟 10 个 0",
);

// --- 逆波兰表达式 ---
console.assert(evalRPN(["2", "1", "+", "3", "*"]) === 9, "((2+1)*3) 应为 9");
console.assert(
  evalRPN(["4", "13", "5", "/", "+"]) === 6,
  "4+(13/5) 应为 6（向零取整）",
);
console.assert(
  evalRPN([
    "10",
    "6",
    "9",
    "3",
    "+",
    "-11",
    "*",
    "/",
    "*",
    "17",
    "+",
    "5",
    "+",
  ]) === 22,
  "LeetCode 官方样例应为 22",
);
console.assert(evalRPN(["42"]) === 42, "单数字表达式应原样返回");

// --- 浏览器双栈 ---
const browser = new BrowserHistory("home.com");
browser.visit("a.com");
browser.visit("b.com");
browser.visit("c.com");
console.assert(browser.back() === "b.com", "后退一次应到 b.com");
console.assert(browser.back() === "a.com", "再退应到 a.com");
console.assert(browser.forward() === "b.com", "前进应回到 b.com");
browser.visit("d.com"); // 从中间分支访问新页
console.assert(browser.getCurrent() === "d.com", "当前页应为 d.com");
console.assert(
  browser.forward() === "d.com",
  "访问新页后前进栈已清空，forward 应原地不动",
);
console.assert(browser.back() === "b.com", "后退应回 b.com");
console.assert(browser.back() === "a.com", "继续后退应回 a.com");
console.assert(browser.back() === "home.com", "再退应回首页");
console.assert(browser.back() === "home.com", "退无可退时应原地不动");

console.log("✅ 22-01 stack 全部断言通过");

export {};
