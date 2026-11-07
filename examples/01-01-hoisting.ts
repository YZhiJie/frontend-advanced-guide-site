// 文件: examples/01-01-hoisting.ts
// ============ 变量提升与函数提升 ============

// ---- 示例 1:var 提升 ----
console.log(a); // undefined —— var 声明被提升并初始化为 undefined,赋值不提升
var a = 1;

// ---- 示例 2:函数声明"整体"提升(声明前即可调用)----
hoisted(); // ✅ '我被提升了' —— 函数声明连同函数体一起提升

function hoisted() {
    console.log('我被提升了');
}

// 面试追问:var 声明与函数声明同名时谁赢?
// 提升阶段函数优先(此时 typeof 同名变量 === 'function'),但后续的变量赋值会在运行时覆盖它。
// ⚠️ 注意:同一作用域下 var 与函数同名重复声明,在 ES Module(严格模式)中会直接报语法错误,
// 上述行为仅在非严格脚本中存在,现代代码不要这样写。

// ---- 示例 3:词法作用域 —— 作用域链在定义时确定,与调用位置无关 ----
const outer = 'outer';
function inner() {
    console.log(outer); // 沿定义处的作用域链查找
}
function run() {
    const outer = 'shadowed'; // 遮蔽了全局的 outer
    inner(); // 依然打印 'outer',证明 JS 是词法(静态)作用域,不是动态作用域
}
inner(); // 'outer'
run();   // 'outer'
