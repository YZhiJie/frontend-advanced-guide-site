// 文件: examples/09-09-type-tests.ts —— 用 tsd 断言公共 API 的类型
// @ts-nocheck —— 示意代码:依赖 tsd,本仓库 examples 不安装该包。实际项目需 npm i -D tsd,文件名约定为 *.test-d.ts。详见 09-testing.md 9.8 节。
//
// 类型测试与运行时测试的区别:
// - tsd 检查的是"使用方的用法被类型系统正确接受/拒绝",不是运行时行为
// - expectType<T>(value)  —— 断言 value 的类型是 T
// - expectError(fn(...))  —— 期望错误用法被类型检查拒绝(否则失败)
// - 比 tsc --noEmit 更严格:tsc 只能验证"代码符合类型",不能验证"使用方"
//
// 真实项目中文件名约定为 *.test-d.ts,在 package.json 配置:
//   "tsd": {"directory": "src"}
//   "scripts": {"test:types": "tsd"}

import { expectType, expectError } from 'tsd';

// 被测函数(实际来自库的导出)
function toCents(yuan: number): number {
    return Math.round(yuan * 100);
}
function applyDiscount(cents: number, percent: number): number {
    if (percent < 0 || percent > 100) throw new RangeError('折扣需在 0~100 之间');
    return Math.round((cents * (100 - percent)) / 100);
}

// ---- 正确用法:类型相符 → 编译通过 ----
expectType<number>(toCents(1));

// ---- 错误用法:期望类型检查报错(用 expectError 包裹) ----
expectError(applyDiscount('100', 10));     // 第一个参数应是 number
expectError(applyDiscount(100, '10'));    // 第二个参数应是 number
expectError(toCents('1'));                 // 参数应是 number

// ---- 字面量联合类型断言 ----
type Status = 'paid' | 'unpaid' | 'cancelled';
const s: Status = 'paid';
expectType<Status>(s);

// ---- 泛型推断断言 ----
function first<T>(arr: readonly T[]): T | undefined {
    return arr[0];
}
const n: number | undefined = first([1, 2, 3]);
expectType<number | undefined>(n);
