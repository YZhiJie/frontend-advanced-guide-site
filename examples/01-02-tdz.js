// 文件: examples/01-02-tdz.js
// ============ 暂时性死区(TDZ)与块级作用域 ============

function demo() {
    // 从作用域开始到 let 声明之间,是变量 x 的"暂时性死区"
    try {
        console.log(x); // 若放开会抛出 ReferenceError
    } catch (e) {
        console.log(e instanceof ReferenceError); // true —— 说明 x 处于 TDZ
    }
    let x = 42;
    console.log(x); // 42 —— 死区结束,正常访问
}

// ---- 块级作用域:var 没有,let/const 有 ----
{
    var varInBlock = 'var 泄漏到了块外';
    let letInBlock = 'let 被关在块里';
}
console.log(varInBlock); // 'var 泄漏到了块外'
// console.log(letInBlock); // ❌ ReferenceError: letInBlock is not defined

demo();
