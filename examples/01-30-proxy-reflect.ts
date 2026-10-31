// 文件: examples/01-30-proxy-reflect.ts
// ============ Proxy / Reflect 元编程与响应式原理(Vue2 defineProperty 版迷你实现) ============
// 学习目标:掌握 13 个捕获器的触发时机、receiver 的意义,并亲手实现依赖收集与自动更新。
// 运行:npx tsx examples/01-30-proxy-reflect.ts

export {};

const log = (title: string) => console.log(`\n---- ${title} ----`);

// ============ 1. Proxy 13 个捕获器全景 ============
log('1. Proxy 的 13 个捕获器');

// get/set/has/deleteProperty/ownKeys/getOwnPropertyDescriptor/
// defineProperty/preventExtensions/isExtensible/getPrototypeOf/setPrototypeOf/apply/construct
console.log('  拦截对象操作:get set has deleteProperty ownKeys defineProperty');
console.log('  拦截元信息:getOwnPropertyDescriptor preventExtensions isExtensible');
console.log('  拦截原型链:getPrototypeOf setPrototypeOf');
console.log('  拦截调用:apply(函数调用) construct(new 实例化)');
console.log('  口诀:Object 上有的内部操作,Proxy 几乎都能拦');

// ============ 2. get/set:虚拟属性与校验 ============
log('2. get / set 捕获器');

const arr2 = new Proxy(['a', 'b', 'c'], {
    get(target, prop, receiver) {
        // 给数组加"负索引"能力:Python 风格的 arr[-1]
        if (typeof prop === 'string' && prop.startsWith('-')) {
            const index = Number(prop);
            return target[index < 0 ? target.length + index : index];
        }
        return Reflect.get(target, prop, receiver); // 原样转发,并保持 this(receiver)正确
    },
});
console.log('  负索引 arr[-1]/[-2]:', (arr2 as any)[-1], (arr2 as any)[-2]); // c b

const validated = new Proxy(
    { age: 0 },
    {
        set(target, prop, value) {
            if (prop === 'age' && (typeof value !== 'number' || value < 0 || value > 150)) {
                throw new RangeError('非法年龄');
            }
            // ⚠️ set 捕获器约定要返回布尔:false 在严格模式下抛 TypeError;用 Reflect.set 最稳妥
            return Reflect.set(target, prop, value);
        },
    },
);
validated.age = 28;
console.log('  合法写入:', validated.age); // 28
try {
    validated.age = -1;
} catch (e) {
    console.log('  非法写入被拦:', (e as Error).message); // 非法年龄
}

// ============ 3. has / ownKeys / deleteProperty:隐藏与审计 ============
log('3. has / ownKeys / deleteProperty');

const secretHolder = new Proxy(
    { publicData: 1, _secret: 42 },
    {
        has(target, prop) {
            if (prop === '_secret') return false; // 连 in 都查不到(但属性物理上仍存在)
            return Reflect.has(target, prop);
        },
        ownKeys(target) {
            // 影响 Object.keys / for...in / getOwnPropertyNames 的可见性
            return Reflect.ownKeys(target).filter((key) => !String(key).startsWith('_'));
        },
        deleteProperty(target, prop) {
            if (String(prop).startsWith('_')) {
                console.log(`  删除受保护属性 ${String(prop)} 被拒绝`);
                return false;
            }
            return Reflect.deleteProperty(target, prop);
        },
    },
);
console.log('  in 检测 _secret:', '_secret' in secretHolder); // false
console.log('  Object.keys:', Object.keys(secretHolder)); // ['publicData']
try {
    delete (secretHolder as any)._secret; // 严格模式:返回 false → TypeError
} catch {
    /* 预期被拦 */
}

// ============ 4. apply / construct:包装函数与构造过程 ============
log('4. apply / construct');

function sum(a: number, b: number) {
    return a + b;
}
const loggedSum = new Proxy(sum, {
    apply(target, thisArg, args) {
        console.log(`  调用日志:sum(${args.join(', ')})`);
        return Reflect.apply(target, thisArg, args); // 转发,保留 this 和参数
    },
});
console.log('  结果:', loggedSum(2, 3)); // 日志 + 5

function User(this: { name: string }, name: string) {
    this.name = name;
}
let instanceCount = 0;
const TrackedUser = new Proxy(User as unknown as new (n: string) => { name: string }, {
    construct(target, args, newTarget) {
        instanceCount++;
        // 第三参数 newTarget:保证实例的原型链指向 new.target.prototype(继承场景关键)
        return Reflect.construct(target as never, args, newTarget);
    },
});
new TrackedUser('阿黄');
new TrackedUser('阿黑');
console.log('  构造次数被统计:', instanceCount); // 2

// ============ 5. receiver:继承体系下 getter 的 this 指向 ============
log('5. Reflect.get 的 receiver 为什么不能省');

const protoData = {
    tag: '原型自身',
    get name() {
        return this.tag;
    },
};
// 关键场景:代理对象被另一个对象继承,heir.name 的 getter 里 this 应是 heir
const goodProxy = new Proxy(protoData, {
    get(target, prop, receiver) {
        // receiver 是"真正触发读取的对象"(heir),getter 的 this 就绑定为它 —— 多态成立
        return Reflect.get(target, prop, receiver);
    },
});
const heir = Object.create(goodProxy);
heir.tag = '继承者';
console.log('  带 receiver(正确):', heir.name); // 继承者

const badProxy = new Proxy(protoData, {
    get(target, prop) {
        return Reflect.get(target, prop); // 省略 receiver:this 默认 target,继承多态失效
    },
});
const badHeir = Object.create(badProxy);
badHeir.tag = '继承者';
console.log('  不传 receiver(错误):', badHeir.name); // 原型自身

// ============ 6. 可撤销代理:临时授权后彻底切断访问 ============
log('6. Proxy.revocable');

const revocable = Proxy.revocable(
    { token: 'temp-credential' },
    {
        get(target, prop) {
            console.log('  代理存活期间可读');
            return Reflect.get(target, prop);
        },
    },
);
console.log('  撤销前:', revocable.proxy.token);
revocable.revoke();
try {
    console.log(revocable.proxy.token);
} catch {
    console.log('  revoke 后任何操作都抛 TypeError,访问通道被物理切断');
}

// ============ 7. 响应式内核(Vue2 思想):依赖收集 + 自动通知 ============
log('7. defineProperty 版迷你响应式(Vue2 Dep/Watcher 范式)');

// 7.1 全局指针:当前正在执行、需要被收集的"副作用函数"(对应 Vue2 的 Watcher)
let activeReactiveFn: (() => void) | null = null;
function watchFn(fn: () => void) {
    activeReactiveFn = fn;
    fn(); // 首次执行:读取响应式属性 → get 拦截 → 把 fn 收进对应 Depend
    activeReactiveFn = null;
}

// 7.2 Depend:一个属性对应一个依赖集合(Set 自动去重,同一函数不重复收集)
class Depend {
    private reactiveFns = new Set<() => void>();

    depend() {
        if (activeReactiveFn) this.reactiveFns.add(activeReactiveFn);
    }

    notify() {
        this.reactiveFns.forEach((fn) => fn());
    }
}

// 7.3 两级映射:targetMap:WeakMap<对象, Map<属性名, Depend>>
//     弱引用的意义:对象被回收时,整张依赖表随之 GC,不泄漏
const targetMap = new WeakMap<object, Map<PropertyKey, Depend>>();
function getDepend(target: object, key: PropertyKey): Depend {
    let depsMap = targetMap.get(target);
    if (!depsMap) {
        depsMap = new Map();
        targetMap.set(target, depsMap);
    }
    let dep = depsMap.get(key);
    if (!dep) {
        dep = new Depend();
        depsMap.set(key, dep);
    }
    return dep;
}

// 7.4 Vue2 方案:遍历对象"已存在"的 key,逐个改成 getter/setter
function reactiveVue2<T extends object>(target: T): T {
    Object.keys(target).forEach((key) => {
        let value: unknown = (target as Record<string, unknown>)[key];
        if (value && typeof value === 'object') reactiveVue2(value); // 深层递归响应式
        Object.defineProperty(target, key, {
            get() {
                getDepend(target, key).depend(); // 收集当前副作用
                return value;
            },
            set(newValue: unknown) {
                if (newValue === value) return;
                if (newValue && typeof newValue === 'object') reactiveVue2(newValue);
                value = newValue;
                getDepend(target, key).notify(); // 属性变化 → 重跑所有依赖它的函数
            },
        });
    });
    return target;
}

const state2 = reactiveVue2({ count: 0, profile: { name: 'Alice' } });
watchFn(() => console.log('  [Vue2] count 副作用重跑:', state2.count));
state2.count = 1;
state2.count = 2;
watchFn(() => console.log('  [Vue2] 深层属性副作用:', state2.profile.name));
state2.profile.name = 'Bob';

// ============ 8. Proxy 版(Vue3 思想):新增属性也能拦截 ============
log('8. Proxy 版响应式(Vue3 范式,复用同一套依赖机制)');

function reactiveVue3<T extends object>(target: T): T {
    return new Proxy(target, {
        get(target, key, receiver) {
            getDepend(target, key).depend();
            const result = Reflect.get(target, key, receiver);
            if (result && typeof result === 'object') return reactiveVue3(result); // 惰性递归
            return result;
        },
        set(target, key, value, receiver) {
            const success = Reflect.set(target, key, value, receiver);
            getDepend(target, key).notify(); // 拦截发生在对象层,新 key 一样进得来
            return success;
        },
    });
}

const state3 = reactiveVue3<{ a: number; b?: string }>({ a: 1 });
watchFn(() => console.log('  [Vue3] b 当前值:', state3.b ?? '未设置'));
state3.b = '新增的键'; // 首次新增就触发副作用 —— defineProperty 方案做不到

const legacy = reactiveVue2<{ a: number }>({ a: 1 }) as { a: number; b?: number };
watchFn(() => console.log('  [Vue2] b 尝试响应:', legacy.b ?? '未设置'));
legacy.b = 99; // 没有任何重跑日志!新增键没有 setter,这就是 Vue2 必须用 this.$set 的根因

console.log('\n结论:Proxy 代理"整个对象"(支持新键/数组/Map,性能更好);');
console.log('defineProperty 只能逐个劫持"已有属性"(需 $set/$delete 补丁,不支持数组索引语义)。');
console.log('框架源码联动:详见第 4 章 Vue 响应式原理。');
