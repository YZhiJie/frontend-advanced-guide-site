// 文件: examples/01-27-inheritance-evolution.ts
// ============ JS 继承方案六年演进 → ES6 class extends → 多态 / 内置类 / Mixin ============
// 学习目标:看懂老源码里的套路,并理解 class 不是新模型,只是"寄生组合式继承"的语法糖。
// 运行:npx tsx examples/01-27-inheritance-evolution.ts

export {};

const log = (title: string) => console.log(`\n---- ${title} ----`);

// ============ 1. 原型链继承:子类原型 = 父类实例 ============
log('1. 原型链继承(2006 年的写法)');

function Parent1(this: any, name: string) {
    this.name = name;
    this.hobbies = ['读书']; // 引用类型属性 —— 后面所有坑的源头
}
Parent1.prototype.say = function () {
    return `我是 ${this.name}`;
};

function Child1(this: any, age: number) {
    this.age = age;
}
// 关键一步:让子类原型指向父类"实例",父实例的属性和方法都挂到原型链上
Child1.prototype = new (Parent1 as any)('默认姓名');
Child1.prototype.constructor = Child1; // 原型被整体替换,务必把 constructor 指回来

const c1a: any = new (Child1 as any)(3);
const c1b: any = new (Child1 as any)(5);
c1a.hobbies.push('游泳');
// ⚠️ 致命缺陷一:引用类型属性被所有实例共享,c1a 改了 c1b 跟着变
console.log('实例 b 的 hobbies 被污染:', c1b.hobbies); // ['读书','游泳']
// ⚠️ 致命缺陷二:创建子实例时没法给父构造传参(总不能每个实例都改原型)
console.log('两个实例都说自己叫:', c1a.say(), '/', c1b.say());

// ============ 2. 借用构造函数(经典继承):Parent.call(this) ============
log('2. 借用构造函数');

function Parent2(this: any, name: string) {
    this.name = name;
    this.hobbies = ['读书'];
}
function Child2(this: any, name: string, age: number) {
    Parent2.call(this, name); // "借"父构造在子实例上执行一遍:每个实例独立字段
    this.age = age;
    this.say = function () {
        return `我是 ${this.name}`;
    }; // ⚠️ 方法只能写进构造函数:每个实例复制一份,无法复用原型
}

const c2a: any = new (Child2 as any)('阿黄', 3);
const c2b: any = new (Child2 as any)('阿黑', 5);
c2a.hobbies.push('游泳');
console.log('引用类型不再共享:', c2a.hobbies, c2b.hobbies); // ['读书','游泳'] ['读书']
console.log('可以向父构造传参:', c2a.name, c2b.name); // 阿黄 阿黑
console.log('但方法不是同一个函数:', c2a.say !== c2b.say); // true(不同实例各有一份)

// ============ 3. 组合继承:借构造 + 原型链(ES6 之前最常用) ============
log('3. 组合继承');

function Parent3(this: any, name: string) {
    this.name = name;
    this.hobbies = ['读书'];
}
Parent3.prototype.say = function () {
    return `我是 ${this.name}`;
};
function Child3(this: any, name: string, age: number) {
    Parent3.call(this, name); // 第二次调用:实例自身得到字段(遮蔽原型上的同名属性)
    this.age = age;
}
Child3.prototype = new (Parent3 as any)('占位'); // 第一次调用:仅为继承原型方法
Child3.prototype.constructor = Child3;
Child3.prototype.sayAge = function () {
    return `${this.age} 岁`;
};

const c3: any = new (Child3 as any)('阿黄', 3);
console.log('字段独立 + 方法复用:', c3.hobbies, c3.say(), c3.sayAge());
// ⚠️ 唯一缺点:父构造被调两次,原型上残留一份无用的 name/hobbies(被实例属性遮蔽)
console.log('原型上的冗余属性:', Child3.prototype.name, Child3.prototype.hobbies);

// ============ 4. 原型式继承:Object.create 的前身 ============
log('4. 原型式继承');

// Crockford 2006 年提出的极简范式,ES5 被标准化为 Object.create
function objectCreateShim(o: object) {
    function F(this: any) {}
    F.prototype = o; // 临时空构造做"中转",不执行任何父构造逻辑
    return new (F as any)();
}
const person4 = { name: '无名氏', hobbies: ['读书'] };
const c4a = objectCreateShim(person4);
const c4b = Object.create(person4); // 标准化后一行搞定
c4a.name = '阿黄';
c4a.hobbies.push('游泳');
// ⚠️ 与原型链继承相同:引用类型属性共享;适合"只想浅克隆一个对象"的场景
console.log('Object.create 等价写法:', c4a.name, c4b.hobbies); // 阿黄 ['读书','游泳']

// ============ 5. 寄生式继承:在原型式对象上"增强"再返回 ============
log('5. 寄生式继承');

function createEnhanced(original: { name: string }) {
    const clone: { name: string; greet: () => string } = Object.create(original);
    clone.greet = function () {
        return `Hi, ${this.name}`;
    }; // 像寄生虫一样给对象追加方法
    return clone;
}
const c5 = createEnhanced({ name: '阿黄' });
console.log('增强后的对象:', c5.greet());

// ============ 6. 寄生组合式继承:组合继承的完美修补 ============
log('6. 寄生组合式继承(class extends 的真实本质)');

// 用空构造中转复制原型,避免 new Parent() 那次多余调用
function inheritPrototype(Child: Function, Parent: Function) {
    const proto = Object.create(Parent.prototype); // 只拿原型方法,不调父构造
    proto.constructor = Child;
    Child.prototype = proto;
    // 等价现代写法:Object.setPrototypeOf(Child.prototype, Parent.prototype)
}

function Parent6(this: any, name: string) {
    this.name = name;
    this.hobbies = ['读书'];
}
Parent6.prototype.say = function () {
    return `我是 ${this.name}`;
};
function Child6(this: any, name: string, age: number) {
    Parent6.call(this, name); // 父构造只执行这一次
    this.age = age;
}
inheritPrototype(Child6, Parent6);
Child6.prototype.sayAge = function () {
    return `${this.age} 岁`;
};

const c6: any = new (Child6 as any)('阿黄', 3);
console.log('继承效果完整:', c6.say(), c6.sayAge(), c6.hobbies);
console.log('原型上不再有冗余 name:', Child6.prototype.name); // undefined
console.log('原型链关系正确:', Object.getPrototypeOf(Child6.prototype) === Parent6.prototype); // true

// ============ 7. ES6 class extends:同一套机制的声明式语法 ============
log('7. ES6 class + super');

class Animal {
    constructor(public name: string) {}

    say() {
        return `我是 ${this.name}`;
    }

    static create(name: string) {
        return new this(name); // 静态方法中的 this 指向"当前类",子类调用时绑定到子类
    }
}

class Dog extends Animal {
    constructor(
        name: string,
        public breed: string,
    ) {
        super(name); // ⚠️ 构造函数里访问 this 之前必须先 super()(ES6 硬性规定)
    }

    say() {
        // super.xxx():先在 [[HomeObject]].prototype(父原型)上找方法,
        // 但调用时 this 仍是子类实例,所以父 say 里读到的是子实例的 name
        return `${super.say()},一只${this.breed}`;
    }
}

const dog = new Dog('阿黄', '柴犬');
console.log(dog.say()); // 我是 阿黄,一只柴犬
console.log('instanceof 两条链都成立:', dog instanceof Dog, dog instanceof Animal); // true true
console.log('静态方法 this 多态:', Dog.create('阿黑') instanceof Dog); // true

// ============ 8. 多态:同一接口,不同实现 ============
log('8. 多态');

abstract class Shape {
    abstract area(): number;
}
class Circle extends Shape {
    constructor(public r: number) {
        super();
    }
    area() {
        return Math.PI * this.r ** 2;
    }
}
class Rectangle extends Shape {
    constructor(
        public w: number,
        public h: number,
    ) {
        super();
    }
    area() {
        return this.w * this.h;
    }
}
// 调用方只依赖 Shape 抽象,不关心具体子类 —— 这就是多态的价值:对扩展开放
function totalArea(shapes: Shape[]) {
    return shapes.reduce((sum, s) => sum + s.area(), 0);
}
console.log('总面积:', totalArea([new Circle(2), new Rectangle(3, 4)]).toFixed(2)); // 12.57+12=24.57

// ============ 9. 继承内置类 + Symbol.species ============
log('9. 继承内置类');

class Stack<T> extends Array<T> {
    peek(): T | undefined {
        return this[this.length - 1];
    }
    pushMany(...items: T[]) {
        this.push(...items);
        return this;
    }
}
const stack = new Stack<number>().pushMany(1, 2, 3);
console.log('栈顶:', stack.peek(), '长度:', stack.length); // 3 3
console.log('map 结果仍是子类(默认 species):', stack.map((x) => x * 2) instanceof Stack); // true

class PlainArray<T> extends Array<T> {
    // Symbol.species 决定 map/filter/slice 等"派生新数组"时用哪个构造器
    static get [Symbol.species]() {
        return Array;
    }
}
const pa = new PlainArray(1, 2, 3);
console.log('覆盖 species 后 map 返回普通数组:', pa.map((x) => x).constructor.name); // Array

// ============ 10. Mixin:用组合绕开"单继承"限制 ============
log('10. Mixin 混入');

type Constructor<T = object> = new (...args: any[]) => T;

// Mixin 是一个"类工厂":传入基类,返回增强后的子类
function WithTimestamp<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
        createdAt = new Date(0); // 固定纪元时间,保证输出确定
    };
}
function WithId<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
        id = Math.floor(/* 演示用 */ 1000 + 42);
    };
}

class Order extends WithId(WithTimestamp(class {
    constructor(public item: string) {}
})) {}

const order = new Order('键盘');
console.log('多重混入:', order.item, order.id, order.createdAt.toISOString()); // 键盘 1042 1970-01-01...
console.log('mixin 本质是原型链叠加:', order instanceof Order); // true
