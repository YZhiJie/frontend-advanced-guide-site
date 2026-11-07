// 文件: examples/01-12-event-loop.js
// ============ 事件循环输出题:由浅入深 ============

// ---- 第 1 题:基础 ----
console.log('1');
setTimeout(() => console.log('2'), 0);           // 宏任务
Promise.resolve().then(() => console.log('3'));  // 微任务
console.log('4');
// 输出:1 4 3 2 —— 同步代码(1,4) → 微任务(3) → 宏任务(2)

// ---- 第 2 题:微任务队列会"清空到见底"才走宏任务 ----
setTimeout(() => console.log('A'), 0);
Promise.resolve()
    .then(() => {
        console.log('B');
        Promise.resolve().then(() => console.log('C')); // 新微任务插到队尾,本轮也会执行
    })
    .then(() => console.log('D'));
console.log('E');
// 输出:E B C D A —— 同步(E) → 微任务依次:B、C、D → 宏任务:A

// ---- 第 3 题:await 的本质 —— 后面的代码相当于 then 回调 ----
async function async1() {
    console.log('async1 start');
    await async2();
    console.log('async1 end'); // 相当于放在 then 里
}
async function async2() {
    console.log('async2');
}
console.log('script start');
setTimeout(() => console.log('setTimeout'), 0);
async1();
new Promise((resolve) => {
    console.log('promise1');
    resolve();
}).then(() => console.log('promise2'));
console.log('script end');
// 输出顺序:
// script start → async1 start → async2 → promise1 → script end
// → async1 end → promise2 → setTimeout
