// 文件: examples/16-01-node-event-loop.ts —— Node 事件循环:可验证的执行顺序
import fs from 'node:fs';

// ---- 第一组:主模块内 setTimeout(0) vs setImmediate(顺序不确定) ----
setTimeout(() => console.log('setTimeout'), 0);
setImmediate(() => console.log('setImmediate'));
Promise.resolve().then(() => console.log('微任务')); // 微任务:当前操作结束后立即执行
console.log('同步代码');
// 输出:同步代码 → 微任务 → (setTimeout/setImmediate 顺序不定)

// ---- 第二组:在 I/O 回调内,setImmediate 永远先于 setTimeout(0) ----
fs.readFile(import.meta.filename ?? '', () => {
    console.log('--- I/O 回调内 ---');
    setTimeout(() => console.log('setTimeout'), 0);
    setImmediate(() => console.log('setImmediate')); // ✓ 保证先打印:check 阶段紧邻 poll 阶段
});

// ---- 第三组:process.nextTick —— 优先级最高的"微任务" ----
Promise.resolve().then(() => console.log('promise then'));
process.nextTick(() => console.log('nextTick'));
// 输出顺序:nextTick → promise then(nextTick 队列先于 Promise 微任务队列清空)
