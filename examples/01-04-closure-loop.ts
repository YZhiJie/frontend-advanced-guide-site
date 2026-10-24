// 文件: examples/01-04-closure-loop.ts
// ============ 示例 2:经典循环陷阱与修复 ============

// ❌ 陷阱:var 没有块级作用域,三个回调共享同一个 i
for (var i = 0; i < 3; i++) {
    setTimeout(() => console.log('var 版本:', i)); // 3 3 3 —— 循环结束时 i 已经是 3
}

// ✅ 修复一:let 每轮循环创建一个新的词法环境,各自捕获各自的 i
for (let j = 0; j < 3; j++) {
    setTimeout(() => console.log('let 版本:', j)); // 0 1 2
}

// ✅ 修复二:IIFE 立即执行函数,手动为每轮创建独立作用域(ES5 时代的做法)
for (var k = 0; k < 3; k++) {
    ((captured) => {
        setTimeout(() => console.log('IIFE 版本:', captured)); // 0 1 2
    })(k);
}
