// 文件: examples/02-06-utility-types.ts
// ============ 手写内置工具类型:每一行都是前面知识的综合运用 ============

// ---- Partial<T>:所有属性变可选 —— 映射类型 + ? ----
type MyPartial<T> = { [K in keyof T]?: T[K] };

// ---- Required<T>:所有属性变必选 —— -? 移除可选修饰符 ----
type MyRequired<T> = { [K in keyof T]-?: T[K] };

// ---- Readonly<T>:所有属性只读 ----
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };

// ---- Pick<T, K>:挑选指定键 —— 约束键必须在 T 中 ----
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };

// ---- Omit<T, K>:排除指定键 —— Pick + 排除联合 ----
type MyOmit<T, K extends keyof T> = MyPick<T, Exclude<keyof T, K>>;

// ---- Record<K, V>:键的集合 → 值类型的映射 ----
type MyRecord<K extends keyof never, V> = { [P in K]: V };

// ---- Exclude<T, U>:从联合中排除 ----
type MyExclude<T, U> = T extends U ? never : T; // 依赖分布式条件类型

// ---- Extract<T, U>:从联合中保留 ----
type MyExtract<T, U> = T extends U ? T : never;

// ---- NonNullable<T>:排除 null / undefined ----
type MyNonNullable<T> = T extends null | undefined ? never : T;

// ---- ReturnType<T>:提取函数返回值 ----
type MyReturnType<T extends (...args: never[]) => unknown> = T extends (...args: never[]) => infer R ? R : never;

// ---- Parameters<T>:提取函数参数元组 ----
type MyParameters<T extends (...args: never[]) => unknown> = T extends (...args: infer P) => unknown ? P : never;

// ---- ConstructorParameters / InstanceType:类维度 ----
class Point { constructor(public x: number, public y: number) {} }
type CtorParams = ConstructorParameters<typeof Point>; // [x: number, y: number]
type PointInstance = InstanceType<typeof Point>;       // Point

// ---- 验证 ----
interface Todo { id: number; title: string; done?: boolean }
type T1 = MyPartial<Todo>;      // { id?: number; title?: string; done?: boolean }
type T2 = MyPick<Todo, 'id'>;   // { id: number }
type T3 = MyOmit<Todo, 'id'>;   // { title: string; done?: boolean }
type T4 = MyExclude<'a' | 'b' | 'c', 'a'>; // 'b' | 'c'
const fn = (a: string, b: number) => true;
type T5 = MyReturnType<typeof fn>;   // boolean
type T6 = MyParameters<typeof fn>;   // [a: string, b: number]

const t3: T3 = { title: 'x' };
// T4/T5/T6 是纯类型,编辑器悬停验证即可(运行时引用类型名会报 ReferenceError)
console.log(t3, {} as T1, {} as T2, {} as CtorParams, {} as PointInstance);

// ---- 递归工具类型:DeepReadonly(面试进阶)----
type DeepReadonly<T> = T extends (infer R)[]
    ? readonly DeepReadonly<R>[]
    : T extends Function
      ? T
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

interface Config { server: { host: string; ports: number[] }; debug: boolean }
const frozen: DeepReadonly<Config> = {
    server: { host: 'localhost', ports: [3000] },
    debug: true,
};
// frozen.server.host = 'x';          // ❌ 编译错误:只读
// frozen.server.ports.push(8080);    // ❌ 编译错误:数组也是只读的
console.log(frozen);
