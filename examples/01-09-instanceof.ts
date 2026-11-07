// 文件: examples/01-09-instanceof.ts
// ============ 手写 instanceof:沿原型链逐层比对 ============

function myInstanceof(obj: unknown, ctor: Function): boolean {
    // 基本类型直接返回 false
    if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) {
        return false;
    }
    let proto: object | null = Object.getPrototypeOf(obj);
    while (proto !== null) {
        if (proto === ctor.prototype) return true; // 找到匹配的原型
        proto = Object.getPrototypeOf(proto);      // 继续向上
    }
    return false;
}

class A {}
class B extends A {}
const b = new B();

console.log(myInstanceof(b, B));      // true
console.log(myInstanceof(b, A));      // true
console.log(myInstanceof(b, Object)); // true
console.log(myInstanceof(b, Array));  // false
console.log(myInstanceof(1, Number)); // false —— 基本类型无原型链(自动装箱前的字面量)
console.log(b instanceof A);          // true —— 与原生行为一致
