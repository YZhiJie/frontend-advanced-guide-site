// 文件: examples/02-04-conditional-infer.ts
// ============ 条件类型与 infer:类型层面的"解构赋值"============

// ---- infer 捕获:从既有类型中"抽"出需要的部分 ----
type ElementType<T> = T extends (infer E)[] ? E : never;          // 数组元素类型
type DeepAwait<T> = T extends Promise<infer V> ? DeepAwait<V> : T; // 递归解包 Promise(内置 Awaited 的简化版)
type ReturnTypeOf<T> = T extends (...args: never[]) => infer R ? R : never; // 函数返回值
type ParamsOf<T> = T extends (...args: infer P) => unknown ? P : never;     // 函数参数元组

type A1 = ElementType<string[]>;        // string
type A2 = DeepAwait<Promise<Promise<number>>>; // number —— 递归解包
type A3 = ReturnTypeOf<typeof fetch>;   // Promise<Response>
type A4 = ParamsOf<(a: string, b: number) => void>; // [a: string, b: number]

// ---- 实战:解包 React/Vue 组合式函数的返回值 ----
declare function useUser(): { user: Promise<{ id: string }>; loading: boolean };
type UnpackedUseUser = { [K in keyof ReturnType<typeof useUser>]: DeepAwait<ReturnType<typeof useUser>[K]> };
const unpacked: UnpackedUseUser = { user: { id: '1' }, loading: false }; // Promise 被解包成数据本体

// ---- 分布式条件类型:联合类型会"逐个分发" ----
type ToArray<T> = T extends unknown ? T[] : never;
type A5 = ToArray<string | number>; // string[] | number[] —— 而不是 (string|number)[]

// 阻止分发:用 [T] 包一层元组
type ToArrayNonDist<T> = [T] extends [unknown] ? T[] : never;
type A6 = ToArrayNonDist<string | number>; // (string | number)[]

// 经典应用:Diff / 过滤联合类型
type Diff<T, U> = T extends U ? never : T;
type Filter<T, U> = T extends U ? T : never;
type A7 = Diff<'a' | 'b' | 'c', 'a'>;         // 'b' | 'c'
type A8 = Filter<string | number | boolean, string | number>; // string | number

// ---- 映射元组:批量解包 Promise 元组 ----
type UnwrapTuple<T extends unknown[]> = { [K in keyof T]: DeepAwait<T[K]> };
type A9 = UnwrapTuple<[Promise<string>, Promise<number>, Promise<boolean>]>; // [string, number, boolean]

// ---- 实战:提取路由参数(:id / :uid 两种占位)----
type ExtractRouteParams<T extends string> = T extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractRouteParams<Rest>]: string }
    : T extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : Record<string, never>;

type P1 = ExtractRouteParams<'/user/:id'>;                    // { id: string }
type P2 = ExtractRouteParams<'/user/:id/post/:postId'>;       // { id: string; postId: string }
type P3 = ExtractRouteParams<'/about'>;                       // {}

const params: P2 = { id: '1', postId: '9' };
console.log(params);
