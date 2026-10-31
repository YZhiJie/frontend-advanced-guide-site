// 文件: examples/01-21-deep-clone.ts
// ============ 深拷贝:处理循环引用、Date/RegExp/Map/Set ============

function deepClone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
    // 1. 基本类型与 null 直接返回
    if (value === null || typeof value !== 'object') return value;

    // 2. 循环引用:已克隆过的对象直接返回缓存(这也是 WeakMap 而非 Map 的原因)
    const cached = seen.get(value as object);
    if (cached !== undefined) return cached as T;

    // 3. 特殊对象类型
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (value instanceof RegExp) return new RegExp(value.source, value.flags) as T;

    if (value instanceof Map) {
        const result = new Map();
        seen.set(value, result);
        value.forEach((v, k) => result.set(deepClone(k, seen), deepClone(v, seen)));
        return result as T;
    }
    if (value instanceof Set) {
        const result = new Set();
        seen.set(value, result);
        value.forEach((v) => result.add(deepClone(v, seen)));
        return result as T;
    }

    // 4. 普通对象 / 数组:保留原型(兼容类实例)
    const result: Record<PropertyKey, unknown> = Array.isArray(value)
        ? []
        : Object.create(Object.getPrototypeOf(value));
    seen.set(value, result);

    // Reflect.ownKeys 同时包含 Symbol 键;跳过不可枚举属性用 for...in + hasOwn 更简单,这里求全
    for (const key of Reflect.ownKeys(value)) {
        result[key] = deepClone((value as Record<PropertyKey, unknown>)[key], seen);
    }
    return result as T;
}

// ---- 验证:循环引用 ----
interface Node { name: string; self?: unknown }
const a: Node = { name: 'a' };
a.self = a; // 循环引用,普通递归会栈溢出
const cloned = deepClone(a);
console.log(cloned.name);                  // 'a'
console.log(cloned.self === cloned);       // true —— 克隆体内部循环关系被保留
console.log(cloned !== a);                 // true —— 是全新对象

// ---- 验证:Map/Set/Date ----
const complex = new Map([['date', new Date('2026-01-01')], ['set', new Set([1, 2])]]);
const clonedComplex = deepClone(complex);
console.log(clonedComplex.get('date') instanceof Date);          // true
console.log(clonedComplex.get('date') !== complex.get('date'));  // true —— 新的 Date 实例

// 💡 生产提示:运行环境支持时,内置 structuredClone() 是更简单可靠的选择(不支持函数/Symbol/DOM 节点)
const builtIn = structuredClone({ list: [1, { ok: true }], when: new Date() });
console.log(builtIn.list[1].ok); // true
