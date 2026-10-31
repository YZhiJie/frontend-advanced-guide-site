// 文件: examples/01-06-prototype-chain.ts
// ============ 原型链:属性查找机制 ============

const animal = {
    name: '动物',
    speak(this: { name: string }) {
        return `${this.name} 发出声音`;
    },
};

// Object.create(proto):创建一个原型指向 proto 的新对象
const dog = Object.create(animal);
dog.name = '小狗'; // 自有属性(遮蔽了原型上的 name)

console.log(dog.speak());               // '小狗 发出声音' —— speak 在 dog 上找不到,沿原型链到 animal 找到
console.log(Object.keys(dog));          // ['name'] —— 只列自有可枚举属性
console.log('speak' in dog);            // true —— in 会查整条原型链
console.log(Object.hasOwn(dog, 'speak')); // false —— 只看自身(hasOwnProperty 的现代替代)
console.log(Object.getPrototypeOf(dog) === animal); // true
