// 文件: examples/03-01-modules/esm/main.ts
import { count, increment } from './counter.ts';

console.log(count); // 0
increment();
console.log(count); // 1 —— ESM 导出的是"活引用",外部能看到变化

// ---- 对比:CJS 导出的是值拷贝 ----
// counter.cjs:
//   let count = 0;
//   function increment() { count++; }
//   module.exports = { count, increment };
// main.cjs:
//   const { count, increment } = require('./counter.cjs');
//   increment();
//   console.log(count); // 0 —— require 拿到的是快照,外部永远看到旧值
//   console.log(require('./counter.cjs').count); // 1 —— 重新 require 才能拿到新值

// ---- ESM 的三种导入 ----
import { increment as inc } from './counter.ts'; // 具名导入
import * as counter from './counter.ts';          // 命名空间
const mod = await import('./counter.ts');         // 动态导入:返回 Promise,代码分割的基础
console.log(count, inc, counter.count, mod.count);
