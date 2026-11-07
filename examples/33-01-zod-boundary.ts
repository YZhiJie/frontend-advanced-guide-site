// 文件: examples/33-01-zod-boundary.ts
// ============ Zod 边界校验：as 说谎 vs schema 兜底 ============
// 对应 33.1「为什么需要运行时校验」与 33.2「对象、联合与解析入口」：
// - `as` 不产生任何校验，类型与真实值可以完全不一致；
// - schema 是单一事实来源，z.infer 从它推导类型；
// - 边界入参写 unknown，外部数据一律 safeParse；
// - default 让可选字段在输出类型里一定存在，transform 在解析期归一化。

import { z } from "zod";

/** 硬断言：console.assert 在 Node 里不阻断，脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// 1) 编译期断言与运行时校验的差别
type Payload = { id: number; title: string };
const asserted = JSON.parse('{"id":"42","title":"Zod"}') as Payload;
console.log("as 之后的 id 类型：", typeof asserted.id);
assert(typeof asserted.id === "string", "as 不会改写运行时值，id 依然是字符串");

const PayloadSchema = z.object({
  id: z.number().int(),
  title: z.string().min(1),
});
const parsed = PayloadSchema.safeParse(JSON.parse('{"id":"42","title":"Zod"}'));
console.log("schema 校验结果：", parsed.success);
assert(parsed.success === false, "同一份数据应被 schema 判为失败");
if (!parsed.success) {
  console.log("错误路径：", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  assert(parsed.error.issues[0]?.path[0] === "id", "错误应定位到 id 字段");
}

// 2) 对象组合：trim、校验、默认值、可选字段
const UserSchema = z.object({
  username: z.string().trim().min(3).max(20),
  email: z.string().trim().email(),
  age: z.number().int().min(0).max(120).optional(),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});
type User = z.infer<typeof UserSchema>;

const ok = UserSchema.safeParse({ username: " alice ", email: "alice@example.com" });
assert(ok.success, "合法输入应通过校验");
if (ok.success) {
  const user: User = ok.data;
  console.log("输出：", `${user.username}/${user.email}/${user.role}`);
  assert(user.username === "alice", "trim 应在解析期生效");
  assert(user.role === "viewer", "default 应补齐 role，输出类型里它一定存在");
  assert(user.age === undefined, "optional 字段可以不出现");
}

const bad = UserSchema.safeParse({ username: "al", email: "not-an-email", age: "30" });
assert(bad.success === false, "短用户名 + 非法邮箱 + 字符串年龄应全部失败");
if (!bad.success) {
  const issues = bad.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  console.log("全部问题：", issues.join(" | "));
  assert(issues.length >= 3, "三处非法字段应各自产生一条问题");
}

// 3) 判别联合 + transform：细分业务分支与解析期归一化
const EventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("scroll"), offset: z.number().nonnegative() }),
]);
const click = EventSchema.safeParse({ type: "click", x: 10, y: 20 });
assert(click.success, "判别联合应按 type 命中 click 分支");
assert(EventSchema.safeParse({ type: "click", x: 10 }).success === false, "缺字段的分支必须失败");

const AmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "金额格式不合法")
  .transform((text) => Math.round(Number(text) * 100));
const cents = AmountSchema.safeParse("128.50");
assert(cents.success && cents.data === 12850, "transform 应把元转成分为整数");
console.log("金额归一化：", cents.success ? cents.data : "失败");

console.log("✓ 33-01 Zod 边界校验断言全部通过");
