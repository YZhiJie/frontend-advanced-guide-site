// 文件: examples/01-26-property-descriptors.ts
// ============ 属性描述符（Property Descriptor）与对象封闭三档 ============
// 设计决策:Vue2 响应式、class 字段语义、常量配置冻结,底层全部是描述符。
// 每个对象属性都挂着一张"属性配置表",决定它能否改、能否枚举、能否再配置。
// 运行:npx tsx examples/01-26-property-descriptors.ts

// 本文件用 export {} 成为独立模块,避免与其他示例的顶层变量同名冲突(tsc 全量 include)。
export {};

const log = (title: string) => console.log(`\n---- ${title} ----`);
// ESM 模块默认严格模式:违反只读/不可配置会直接抛 TypeError,用这个辅助函数安全演示
const attempt = (label: string, fn: () => void) => {
    try {
        fn();
        console.log(`  ${label}: 成功`);
    } catch (e) {
        console.log(`  ${label}: 抛 ${(e as Error).constructor.name}`);
    }
};

// ============ 1. 数据描述符的四个特性 ============
log('1. 数据描述符');

// 用索引签名类型承接 defineProperty 动态挂载的属性
const product: Record<string, unknown> = {
    id: 1001,
    name: '机械键盘',
};

// 读取描述符:getOwnPropertyDescriptor 只看"自身属性",不查原型链
console.log(Object.getOwnPropertyDescriptor(product, 'name'));
// { value: '机械键盘', writable: true, enumerable: true, configurable: true }

// defineProperty 单条定义;defineProperties 批量定义
Object.defineProperty(product, 'name', {
    value: '静电容键盘',
    writable: true, // 能否被赋值运算符修改
    enumerable: true, // 能否被 for...in / Object.keys / JSON.stringify 枚举
    configurable: true, // 能否再改描述符、能否 delete
});

Object.defineProperties(product, {
    // writable:false —— 只读。注意:defineProperty 中其余特性缺省为 false(与字面量定义不同!)
    fixed: { value: '不可变的值', writable: false, enumerable: true, configurable: true },
    // enumerable:false —— 隐藏属性:存在但不出现在枚举中
    hidden: { value: '我是隐藏属性', writable: true, enumerable: false, configurable: true },
});

attempt('改 writable:false 的属性', () => {
    product.fixed = '试图修改';
});
console.log('  值保持不变 =>', product.fixed);
console.log('Object.keys 含 hidden?', Object.keys(product).includes('hidden')); // false
console.log('in 也能命中隐藏属性:', 'hidden' in product); // true —— 属性确实存在
console.log('getOwnPropertyNames 能取到不可枚举键:', Object.getOwnPropertyNames(product));
console.log('JSON.stringify 也忽略不可枚举:', JSON.stringify(product).includes('hidden')); // false

// configurable:false —— 描述符被锁死:不能再改特性、不能 delete
Object.defineProperty(product, 'fixed', { configurable: false });
attempt('delete configurable:false 的属性', () => {
    delete product.fixed;
});
console.log('  删除失败,值还在:', product.fixed);
// ⚠️ 反直觉的点:writable:true + configurable:false 时,仍可把 writable 从 true 改成 false
//    (单向门:只能"加锁"不能"解锁"),但不能改 enumerable/configurable,也不能改成存取描述符。

// ============ 2. 存取描述符:get / set ============
log('2. 存取描述符(getter/setter)');

const account: { _balance: number; balance: number } = {
    _balance: 100,
    balance: 100,
};

Object.defineProperty(account, 'balance', {
    enumerable: true,
    configurable: true,
    get(this: { _balance: number }) {
        console.log('  [get 被触发]');
        return this._balance;
    },
    set(this: { _balance: number }, newValue: number) {
        if (newValue < 0) throw new RangeError('余额不能为负');
        console.log(`  [set 被触发] ${this._balance} -> ${newValue}`);
        this._balance = newValue;
    },
});

console.log('读取余额:', account.balance);
account.balance = 200;
console.log('再次读取:', account.balance);

// ⚠️ 经典坑:描述符里 value/writable 与 get/set 不能共存,否则:
//    TypeError: Invalid property descriptor.
//    一个属性要么是"数据属性",要么是"存取属性",二者互斥。

// 校验整张描述符表(常用于排查框架代理后的属性行为)
console.log('描述符键:', Object.keys(Object.getOwnPropertyDescriptor(account, 'balance')!));
// [ 'get', 'set', 'enumerable', 'configurable' ] —— 没有 value/writable

// ============ 3. 对象封闭三档:preventExtensions / seal / freeze ============
log('3. 对象封闭三档(限制逐级增强)');

// 对每档对象分别尝试:新增属性 / 修改已有值 / 删除属性
function probe(label: string, obj: Record<string, unknown>) {
    const results: string[] = [];
    const tryOp = (op: string, fn: () => void) => {
        try {
            fn();
            results.push(`${op}✓`);
        } catch {
            results.push(`${op}✗`);
        }
    };
    tryOp('新增', () => {
        obj.extra = 'x';
    });
    tryOp('改值', () => {
        obj.a = '改';
    });
    tryOp('删除', () => {
        delete obj.b;
    });
    console.log(
        `${label} [${results.join(' ')}] extensible=${Object.isExtensible(
            obj,
        )} sealed=${Object.isSealed(obj)} frozen=${Object.isFrozen(obj)} 最终=${JSON.stringify(obj)}`,
    );
}

probe('普通对象          ', { a: 1, b: 2 });
probe('preventExtensions ', Object.preventExtensions({ a: 1, b: 2 })); // 仅禁止新增
probe('seal 封闭         ', Object.seal({ a: 1, b: 2 })); // 禁新增 + 禁删除
probe('freeze 冻结       ', Object.freeze({ a: 1, b: 2 })); // seal + 禁改值

const frozen = Object.freeze({ nested: { level: 1 } });
// ⚠️ freeze 是"浅冻结":只冻第一层,嵌套对象依然可变!
frozen.nested.level = 99;
console.log('浅冻结坑:嵌套层被改成', frozen.nested.level); // 99

// 深冻结:递归冻结(生产中只冻结纯数据配置,避免冻结他人传入的对象)
function deepFreeze<T extends object>(obj: T): T {
    for (const key of Reflect.ownKeys(obj)) {
        const v = (obj as Record<PropertyKey, unknown>)[key];
        if (v && typeof v === 'object') deepFreeze(v as object);
    }
    return Object.freeze(obj);
}

const config = deepFreeze({ db: { host: 'localhost', port: 5432 }, retries: 3 });
console.log('深冻结后嵌套层仍是 5432:', config.db.port); // 5432

// ============ 4. 实战:常量枚举冻结,杜绝运行时误改 ============
log('4. 实战:不可变配置');

const OrderStatus = deepFreeze({
    PENDING: 'pending',
    PAID: 'paid',
    SHIPPED: 'shipped',
});

// (OrderStatus as any).PAID = 'x'; // 严格模式下抛 TypeError
console.log('订单状态枚举:', Object.values(OrderStatus).join('/'));

// ============ 5. 存取描述符实战:拦截读写(Vue2 响应式的最小内核) ============
log('5. 存取描述符:拦截读写');

function withLog<T extends object>(target: T, key: keyof T): T {
    // 用局部变量做真实存储,避免在 get 里再次读 target[key] 造成无限递归
    let store = target[key];
    Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        get() {
            console.log(`  读取 ${String(key)}`);
            return store;
        },
        set(v) {
            console.log(`  写入 ${String(key)}:`, v);
            store = v;
        },
    });
    return target;
}

const watchedUser = withLog({ name: 'Alice', age: 28 }, 'name');
console.log('值:', watchedUser.name);
watchedUser.name = 'Bob';
console.log('最终值:', watchedUser.name);
