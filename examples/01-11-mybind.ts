// 文件: examples/01-11-mybind.ts
// ============ 手写 bind:支持预设参数、支持 new 调用、维护原型链 ============

function myBind(this: (...args: unknown[]) => void, ctx: unknown, ...preset: unknown[]) {
    const original = this;

    const bound = function (this: unknown, ...args: unknown[]) {
        // 用 new 调用 bound 时,this 是新创建的实例 —— 此时应忽略 ctx,让实例属性生效
        const thisArg = this instanceof bound ? this : ctx;
        return original.apply(thisArg, [...preset, ...args]);
    };

    // 维护原型链:让 new bound() 出来的实例能访问原函数原型上的方法
    if (original.prototype) {
        (bound as any).prototype = Object.create(original.prototype);
    }
    return bound;
}

// ---- 验证 ----
function Person(this: { name: string }, name: string) {
    this.name = name;
}
Person.prototype.hi = function (this: { name: string }) {
    return `hi, ${this.name}`;
};

const BoundPerson = myBind.call(Person, null, '默认名') as any;

const p = new (BoundPerson as any)('小明');
console.log(p.name); // '默认名' —— new 调用时预设参数在前、调用参数在后
console.log(p.hi()); // 'hi, 默认名' —— 原型链维护成功
