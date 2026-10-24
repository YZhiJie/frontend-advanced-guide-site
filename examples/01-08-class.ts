// 文件: examples/01-08-class.ts
// ============ ES6 class:原型的语法糖 ============

class Animal {
    protected name: string;

    constructor(name: string) {
        this.name = name;
    }

    speak(): string {
        return `${this.name} 发出声音`;
    }

    static category(): string { // 静态方法挂在类本身上,不在 prototype 上
        return '生物';
    }
}

class Dog extends Animal {
    private color: string;

    constructor(name: string, color: string) {
        super(name); // 必须先调用 super(),之后才能使用 this
        this.color = color;
    }

    speak(): string { // 方法重写(运行时多态)
        return `${this.name}(${this.color}): 汪汪`;
    }
}

const dog = new Dog('旺财', '黄色');
console.log(dog.speak());        // 旺财(黄色): 汪汪
console.log(Animal.category());  // 生物
// dog.name;                     // ❌ 编译错误 —— protected 在 TS 层面禁止外部访问

// 证明 class 本质仍是原型:
console.log(typeof Animal.prototype.speak); // 'function'
console.log(Object.getPrototypeOf(dog) === Dog.prototype); // true
