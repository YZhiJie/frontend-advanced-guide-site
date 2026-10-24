# EP.54 运行时那道边界墙

> 对应正文：[第三十三部分 · Zod 运行时校验](../33-zod.md)

## 剧情回顾

- **第 1 格**：标签君困惑——前后端接口改了一个字段类型（用户 ID 从 number 改成 string），前端 TypeScript 静态类型根本拦不住：后端还是可能发 number 过来，或者字段名打错了 TS 也不会报错。TypeScript 是编译期，运行时全裸奔。有没有办法在运行时也有一道边界墙？
- **第 2 格**：码叔点破——Zod 就是"类型 = 值"。`z.object({ id: z.string() })` 同时定义了 TS 类型和运行时校验逻辑。`z.infer<typeof schema>` 把校验 schema 反向推导出 TS 类型，保证静态和运行时**单一事实来源**。不像 TypeBox 或 io-ts，Zod 的错误消息设计最人性。
- **第 3 格**：像素酱实测——`schema.parse(json)` 抛异常（开发期），`schema.safeParse(json)` 返回 `{ success, data, error }`（生产期）。错误用 `.flatten()` 把嵌套路径拍平，或用 `.format()` 生成人类可读的多行。配合 `z.coerce` 把 `"123"` 自动转成 `123`，配合 `.catch()` 给容错默认值，配合 `.transform()` 在解析时顺便做数据规整。
- **第 4 格**：码叔结案——三个高频坑：`z.infer` 是**输出类型**而不是输入类型（`z.input` 才是校验前类型）、`safeParse` 失败后忘了处理 error 直接访问 `.data`、过度使用 `.refine()` 替代基础 schema 类型导致错误路径不精确。

## 知识点拆解

### 第 1 格 · 单一事实来源

```ts
// schema 同时定义了 运行时逻辑 + TS 类型
const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "名字不能为空"),
  age: z.number().int().positive(),
  email: z.string().email(),
});

// TS 类型从 schema 反推，永远不会漂
type User = z.infer<typeof UserSchema>;
// = { id: string; name: string; age: number; email: string }
```

改 schema 就同时改了运行时校验和 TS 类型——单一事实来源。

### 第 2 格 · parse vs safeParse

```ts
// parse：开发期用，抛异常带详细错误路径
try {
  const user = UserSchema.parse(malformedJson);
} catch (err) {
  if (err instanceof z.ZodError) {
    console.log(err.flatten()); // { formErrors: [], fieldErrors: { age: ["必须为正数"] } }
  }
}

// safeParse：生产期用，永不抛
const result = UserSchema.safeParse(malformedJson);
if (!result.success) {
  console.log(result.error.format()); // 人类可读多行
  return null;
}
console.log(result.data); // 确定安全
```

### 第 3 格 · coerce + catch + transform 三件套

```ts
// coerce: 输入 "123" 自动转 123
const pageSchema = z.coerce.number().int().min(1).default(1);

// catch: 失败给默认值
const bodySchema = UserSchema.catch({ id: "unknown", name: "匿名", age: 0, email: "" });
// parse 永远不会失败，要么成功校验要么用默认值

// transform: 解析后顺便规整
const isoDateSchema = z.string().transform((v) => new Date(v));
// 输出类型是 Date，不是 string
```

### 第 4 格 · 三个最坑

1. **`z.infer` 是输出类型**：`type User = z.infer<typeof UserSchema>` 是 `.parse` 之后的类型。如果 schema 里用了 `.transform()`，`z.infer` 会把 transform 后的值类型带出来。想要输入类型用 `z.input<typeof schema>`。
2. **safeParse 失败不处理**：拿到 `{ success: false, error: ... }` 就直接访问 `.data`——TypeScript 类型守卫没用上，还是 `any`。必须 `if (result.success)` 后才访问 `.data`。
3. **过度 refine**：用 `.refine(v => typeof v === 'number', '必须是数字')` 而不是直接写 `z.number()`——基础类型自带更精确的错误路径和格式化，refine 只用于跨字段校验（比如 `password === confirmPassword`）。

## 坑点清单

> 🔗 正文对照：[《33.7 本章避坑清单》](../33-zod#_33-7-本章避坑清单)

1. **`z.infer` 是输出类型，不是输入类型**：如果 schema 里有 `.transform()` 把 string 转 Date，`z.infer` 推导出的是 `Date`，而实际上后端发来的是 `string`。需要区分时用 `z.input<typeof schema>`（校验前）和 `z.output<typeof schema>`（校验后）。
2. **safeParse 失败后继续访问 `.data`**：类型收窄没生效——`result.success === false` 时 `result.data` 不存在，TS 也没报错因为你忘了写 if 判断。必须严格按 `if (result.success) { ... } else { handleError(result.error) }`。
3. **refine 替代基础类型**：`z.any().refine(v => typeof v === 'number')` 等于绕开 Zod 基础类型系统，错误消息丢失精确字段路径。能用上 `z.string()` / `z.number()` 的场景绝对不要 refine。
4. **`catch` 吞掉所有错误**：`.catch(default)` 会把校验错误全部替换成默认值，开发期看不到任何真实错误。生产期用 catch，开发期（NODE_ENV !== 'production'）用 parse 抛异常更利于调试。

## 自测 3 题

**1. `z.input`、`z.infer`、`z.output` 三者有什么区别？什么时候用哪个？**

<details>
<summary>参考答案</summary>

```ts
const S = z.object({
  id: z.string().transform((v) => v.toUpperCase()),
  count: z.coerce.number(), // 输入可能是 "42"，输出是 42
});

type Input = z.input<typeof S>;
// { id: string; count: number | string }  ← 还没 transform 和 coerce 的原始输入

type Inferred = z.infer<typeof S>;
// { id: string; count: number }  ← parse 之后的输出类型（等同于 z.output）

type Output = z.output<typeof S>;
// { id: string; count: number }
```

- `z.infer` = `z.output` = 运行时 `parse` 成功后返回值的类型，**业务里绝大多数时候用这个**，所以 `z.infer` 最常用
- `z.input` = 原始输入的类型（transform 之前、coerce 之前），**写 `safeParse` 之前的入参时用**
- `z.output` = 显式标注输出类型时用，等价于 infer

99% 的时候你只需要 `z.infer`。

</details>

**2. 写一个完整的 API fetch 封装：fetch + Zod 校验 + safeParse + coerce 容错。**

<details>
<summary>参考答案</summary>

```ts
import { z } from "zod";

// 后端返回的用户列表 API，可能把数字以字符串形式发回来
const UserListSchema = z.array(
  z.object({
    id: z.coerce.number(),          // "123" → 123
    username: z.string().min(1),
    createdAt: z.coerce.date(),    // "2024-01-15" → Date
    isAdmin: z.coerce.boolean(),   // "true" / 1 → true
  })
);

type User = z.infer<typeof UserListSchema>[number];

export async function fetchUsers(): Promise<User[]> {
  const res = await fetch("/api/users");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json(); // 类型 any——全裸奔

  // safeParse 绝不抛，开发期用 parse 更友好
  const result = import.meta.env.PROD
    ? UserListSchema.safeParse(json)
    : { success: true, data: UserListSchema.parse(json) } as any;

  if (!result.success) {
    // 记录错误但不让页面炸
    console.error("Zod 校验失败:", result.error.flatten());
    return [];
  }

  return result.data; // 类型确定安全
}
```

要点：`safeParse` 收住边界、`coerce` 把后端不规范的类型自动规整、开发期用 `parse` 让异常直接暴露。

</details>

**3. safeParse 拿到 success: false 后，如何把错误拍平到每个字段上给表单渲染用？**

<details>
<summary>参考答案</summary>

```ts
const FormSchema = z.object({
  username: z.string().min(3, "至少 3 个字符"),
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(8, "至少 8 位"),
  confirmPassword: z.string(),
}).refine((v) => v.password === v.confirmPassword, {
  message: "两次密码不一致",
  path: ["confirmPassword"],
});

function getFieldErrors(error: z.ZodError) {
  const flat = error.flatten();
  // flat.fieldErrors = { username: ["至少 3 个字符"], email: undefined, ... }
  return flat.fieldErrors;
}

// 渲染时
const result = FormSchema.safeParse(formData);
if (!result.success) {
  const fieldErrors = getFieldErrors(result.error);
  // fieldErrors.username → ["至少 3 个字符"]
  // fieldErrors.confirmPassword → ["两次密码不一致"]
  return { fieldErrors, globalErrors: result.error.flatten().formErrors };
}
```

`.flatten()` 把嵌套路径（比如 `address.city`）拍平成 `address.city` 字符串 key，form 库直接遍历渲染。跨字段校验用 `.refine` 时要显式 `path: ["confirmPassword"]` 指向具体字段，否则会挂在 `formErrors`（全局错误）上。

</details>
