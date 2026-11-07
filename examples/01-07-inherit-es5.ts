// 文件: examples/01-07-inherit-es5.ts
// ============ ES5 经典继承:寄生组合式继承(传统方案中最完善)============

function Animal(this: { name: string }, name: string) {
    this.name = name; // 实例属性:每个实例独立一份
}
Animal.prototype.speak = function (this: { name: string }) {
    return `${this.name} 发出声音`; // 原型方法:所有实例共享一份,省内存
};

function Dog(this: { name: string; color: string }, name: string, color: string) {
    Animal.call(this, name); // ① 借用构造函数:继承实例属性
    this.color = color;
}
// ② 寄生组合:用 Object.create 建立原型链
//    相比 "Dog.prototype = new Animal()" 的好处:不会执行 Animal 构造函数、不会在原型上挂多余实例属性
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.constructor = Dog; // ③ 修复 constructor 指向(否则 constructor 会指向 Animal)
Dog.prototype.fetch = function (this: { name: string }) {
    return `${this.name} 去捡球`;
};

const dog = new (Dog as any)('旺财', '黄色');
console.log(dog.speak());           // 旺财 发出声音 —— 继承自 Animal.prototype
console.log(dog.fetch());           // 旺财 去捡球
console.log(dog instanceof Dog);    // true
console.log(dog instanceof Animal); // true
