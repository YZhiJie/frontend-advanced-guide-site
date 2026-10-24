// 文件: examples/02-05-mapped-template.ts
// ============ 映射类型 × 模板字面量:批量变形类型 ============

interface Product {
    id: string;
    name: string;
    price: number;
}

// ---- 基础映射:所有属性变可选/只读/可空 ----
type MyPartial<T> = { [K in keyof T]?: T[K] };     // 等价于内置 Partial<T> 的实现
type Draft<T> = { -readonly [K in keyof T]: T[K] }; // - 移除修饰符

// ---- 键重映射:批量重命名 ----
// 场景:后端返回蛇形命名,前端统一转驼峰类型
type CamelCase<S extends string> =
    S extends `${infer Head}_${infer Tail}` ? `${Head}${CamelCase<Capitalize<Tail>>}` : S;

type Camelize<T> = {
    [K in keyof T as CamelCase<K & string>]: T[K] extends object ? Camelize<T[K]> : T[K];
};

interface RawProduct {
    product_id: string;
    product_name: string;
    created_at: string;
}
type Product2 = Camelize<RawProduct>;
// 等价于 { productId: string; productName: string; createdAt: string }

// ---- 模板字面量生成"强关联"的 API 形状 ----
// 场景:为对象的每个属性自动生成 getXxx / setXxx
type Getters<T> = {
    [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};
type Setters<T> = {
    [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K]) => void;
};
type Model<T> = T & Getters<T> & Setters<T>;

const product: Model<Product> = {
    id: '1',
    name: '键盘',
    price: 199,
    getId: () => '1',
    getName: () => '键盘',
    getPrice: () => 199,
    setId: (v) => console.log(v),
    setName: (v) => console.log(v),
    setPrice: (v) => console.log(v),
};
product.setName('机械键盘'); // ✅ 方法名与属性类型精确关联
// product.setName(123);     // ❌ 编译错误:name 是 string

// ---- 键过滤:映射为 never 即"删除"该键 ----
type OmitByType<T, U> = {
    [K in keyof T as T[K] extends U ? never : K]: T[K];
};
type WithoutFunctions = OmitByType<Model<Product>, (...args: never[]) => unknown>;
// 只剩 id / name / price

// ---- 实战:类型安全的设计令牌(主题变量)----
type Theme = {
    colorPrimary: string;
    colorText: string;
    fontSizeSm: string;
    fontSizeLg: string;
};
// 自动生成 CSS 变量名映射:--color-primary 等
type CssVar<K extends string> = `--${K & string}`; // 配合 kebab 转换函数使用效果更佳
type ThemeVarMap = { [K in keyof Theme as CssVar<K>]: string };
const cssVars: ThemeVarMap = {
    '--colorPrimary': '#1890ff', // 实际项目可配合正则做 kebab-case(此处展示能力)
    '--colorText': '#333',
    '--fontSizeSm': '12px',
    '--fontSizeLg': '20px',
};
console.log(cssVars, product);
