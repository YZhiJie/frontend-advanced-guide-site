// 文件: examples/01-10-this.ts
// ============ 四条绑定规则与经典丢失场景 ============

const user = {
    name: 'Alice',
    normal() {
        return `我是 ${this.name}`; // 隐式绑定:this = 调用者 user
    },
    arrow: () => `我是 ${(globalThis as any).name}`, // 箭头函数:this 沿用定义处,与 user 无关
    delayed() {
        // ❌ 经典坑:普通函数作为回调,隐式绑定丢失,退化为默认绑定
        setTimeout(function () {
            console.log('延迟(丢失 this):', this.name); // undefined
        }, 100);
        // ✅ 修复:箭头函数捕获外层 delayed 的 this(即 user)
        setTimeout(() => {
            console.log('延迟(箭头修复):', this.name); // Alice
        }, 200);
    },
};

console.log(user.normal());            // 我是 Alice
const detached = user.normal;          // 解构赋值导致"调用者"消失
console.log(detached.call(user));      // 显式绑定找回:我是 Alice
user.delayed();

// ---- call / apply / bind 三兄弟的区别 ----
function greet(this: { name: string }, greeting: string, punctuation: string) {
    return `${greeting}, ${this.name}${punctuation}`;
}
const bob = { name: 'Bob' };

console.log(greet.call(bob, '你好', '!'));    // 立即调用,参数逐个传递
console.log(greet.apply(bob, ['你好', '!'])); // 立即调用,参数以数组传递
const bound = greet.bind(bob, '你好');        // 不立即调用,返回新函数,可预设参数(偏函数)
console.log(bound('?'));                      // 你好, Bob?

// ---- 箭头函数的 this 无法被显式修改 ----
const arrowFn = () => (globalThis as any).tag;
(globalThis as any).tag = 'global';
console.log(arrowFn.call({ tag: 'local' })); // 'global' —— call 对箭头函数无效
