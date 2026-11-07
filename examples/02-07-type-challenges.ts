// 文件: examples/02-07-type-challenges.ts
// ============ 类型体操精选:由易到难 ============

// ---- 1. 元组转联合 ----
type TupleToUnion<T extends unknown[]> = T[number];
type U1 = TupleToUnion<[string, number, boolean]>; // string | number | boolean

// ---- 2. 联合转元组式的交叉(用于"必须同时满足"的合并场景)----
type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never;
type I1 = UnionToIntersection<{ a: 1 } | { b: 2 }>; // { a: 1 } & { b: 2 }
// 原理:函数参数位置是逆变的,多个函数重载的参数会被推断为交叉类型

// ---- 3. DeepPartial:递归可选(测试数据工厂常用)----
type DeepPartial<T> = T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

interface Profile { user: { name: string; address: { city: string } }; age: number }
const patch: DeepPartial<Profile> = { user: { address: { city: '北京' } } }; // ✅ 只传部分嵌套字段
console.log(patch);

// ---- 4. 元组长度:字符串数字互转 ----
type TupleLength<T extends unknown[]> = T['length'];
type L1 = TupleLength<[string, number, boolean]>; // 3

// ---- 5. 数值范围约束(经典:Range/LessThan 的简化应用)----
// 场景:约束 padding 传入 1~5 之间
type Range5 = 1 | 2 | 3 | 4 | 5;
function setPadding(p: Range5) { return p; }
setPadding(3);      // ✅
// setPadding(9);   // ❌ 编译错误

// ---- 6. 泛型组件:props 随数据源自动推导(组件库核心技能)----
interface ListProps<T> {
    items: T[];
    renderItem: (item: T) => React.ReactNode;
    keyOf?: (item: T) => string;
}
// declare 一个虚拟组件签名,重点看调用处的推导
declare function List<T>(props: ListProps<T>): React.JSX.Element;

// const el = <List items={[{id: 1, name: 'x'}]} renderItem={(item) => item.name} />;
// ↑ 悬停 item 可看到 { id: number; name: string } —— 泛型从 items 自动反推

// ---- 7. 模板字面量 + 递归:实现路径类型(表单库 lodash.get 的类型化)----
type PathsOf<T> = T extends object
    ? { [K in keyof T & string]: T[K] extends object ? K | `${K}.${PathsOf<T[K]>}` : K }[keyof T & string]
    : never;

type ProfilePaths = PathsOf<Profile>; // 'user' | 'age' | 'user.name' | 'user.address' | 'user.address.city'

function getByPath<T>(obj: T, path: PathsOf<T>): unknown {
    let node: unknown = obj;
    for (const key of String(path).split('.')) {
        if (node === null || typeof node !== 'object') return undefined;
        node = (node as Record<string, unknown>)[key];
    }
    return node;
}
const profile: Profile = { user: { name: 'Alice', address: { city: '北京' } }, age: 18 };
console.log(getByPath(profile, 'user.address.city')); // ✅ 自动补全 & 非法路径报错 → '北京'
