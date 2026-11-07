// 文件: cases/01-deep-clone-lab/src/deep-clone.ts
// ============ 手写生产级 deepClone：把深拷贝的坑位逐个补齐 ============

/**
 * 无法安全克隆的内建对象：WeakMap / WeakSet / Promise 的内部状态不可枚举，
 * 强行兜底克隆只会得到一个错误的空壳，因此原样返回。
 */
function isUncloneable(value: object): boolean {
    return value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise
}

/**
 * 递归克隆的核心实现。
 * @param value 待克隆的值
 * @param seen 已克隆对象缓存：用 WeakMap 记录，既能斩断循环引用，又不会阻止对象被 GC 回收
 */
function cloneInternal(value: unknown, seen: WeakMap<object, unknown>): unknown {
    // 1. 基本类型（string / number / boolean / bigint / symbol / undefined / null）直接返回
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        return value
    }

    // 2. 函数不可克隆（闭包与原型状态无法复制），按原样返回
    if (typeof value === 'function') return value

    const obj = value as object

    // 3. 循环引用：命中缓存说明该对象正在被克隆或已克隆完成，直接复用，避免无限递归
    if (seen.has(obj)) return seen.get(obj)

    // 4. 特殊内建类型：保留其内部数据
    if (obj instanceof Date) return new Date(obj.getTime())
    if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags)
    if (isUncloneable(obj)) return obj

    // 5. Map：先写入缓存再遍历，键与值都要深克隆（覆盖“以对象为键”的场景）
    if (obj instanceof Map) {
        const result = new Map<unknown, unknown>()
        seen.set(obj, result)
        obj.forEach((v, k) => {
            result.set(cloneInternal(k, seen), cloneInternal(v, seen))
        })
        return result
    }

    // 6. Set：同样先写入缓存再遍历
    if (obj instanceof Set) {
        const result = new Set<unknown>()
        seen.set(obj, result)
        obj.forEach((v) => result.add(cloneInternal(v, seen)))
        return result
    }

    // 7. 数组：新建空数组并登记缓存，逐个索引深克隆（含数组上挂载的自定义键）
    if (Array.isArray(obj)) {
        const result: unknown[] = []
        seen.set(obj, result)
        const source = obj as unknown as Record<PropertyKey, unknown>
        const target = result as unknown as Record<PropertyKey, unknown>
        for (const key of Reflect.ownKeys(obj)) {
            if (key === 'length') continue
            target[key] = cloneInternal(source[key], seen)
        }
        return result
    }

    // 8. 普通对象 / 类实例：用同一条原型链创建，原型上的方法等成员得以保留
    //    Reflect.ownKeys 能同时取到字符串键与 Symbol 键
    const result = Object.create(Object.getPrototypeOf(obj)) as Record<PropertyKey, unknown>
    seen.set(obj, result)
    const source = obj as Record<PropertyKey, unknown>
    for (const key of Reflect.ownKeys(obj)) {
        result[key] = cloneInternal(source[key], seen)
    }
    return result
}

/**
 * 深拷贝：返回与入参结构一致的全新值。
 * 覆盖基本类型、Date/RegExp/Map/Set、数组/纯对象、Symbol 键、循环引用与原型链保留。
 */
export function deepClone<T>(value: T): T {
    return cloneInternal(value, new WeakMap<object, unknown>()) as T
}
