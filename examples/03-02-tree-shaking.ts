// 文件: examples/03-02-tree-shaking.ts —— 帮助你理解"摇不掉"的写法
// ============ 会阻止 Tree Shaking 的三种代码 ============

// 1. ✅ 可摇:纯 ESM 具名导出,未使用的函数会被删除
export function used() { return 'used'; }
export function unused() { return 'this will be dropped'; }

// 2. ❌ 摇不掉:副作用代码(顶层执行)——打包器不敢删
export const config = { api: loadConfig() };
function loadConfig() { console.log('顶层副作用:初始化配置'); return {}; }

// 3. ❌ 摇不掉:给原型/全局对象挂方法
// Array.prototype.last = function () { ... };

// 4. ⚠️ 部分可摇:对象属性聚合 —— unusedMember 可能被保留
export const utils = {
    usedMember: () => 1,
    unusedMember: () => 2,
};
// 💡 最佳做法:导出离散的具名函数,而不是大对象(很多老工具库的通病)
