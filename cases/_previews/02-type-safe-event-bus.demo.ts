// 02-type-safe-event-bus 在线预览：泛型事件总线的订阅 / 发布 / 取消
import { createEventBus } from "../02-type-safe-event-bus/src/event-bus.ts";
import { section, button, buttonRow, output, log } from "./shared.ts";

// 事件名与 payload 的映射：传错 payload 类型在源码工程里编译不过
// （type 别名带隐式索引签名，满足 EventMap = Record<string, unknown> 约束；interface 反而不行）
type Events = {
  "user/login": { id: number; name: string };
  "user/logout": void;
  "cart/add": { sku: string; qty: number };
};

const sec = section(
  "类型安全事件总线",
  "点击按钮发布事件，日志展示哪些订阅者收到 typed payload",
);
const out = output(sec);
const bus = createEventBus<Events>();

const audit = (name: string) => (payload: unknown) =>
  log(
    out,
    `[审计] 收到 ${name}：${JSON.stringify(payload ?? "无 payload")}`,
    "info",
  );

bus.on("user/login", (p) =>
  log(out, `[会话] 登录成功：${p.name}(#${p.id})`, "ok"),
);
bus.on("user/login", audit("user/login"));
bus.on("user/logout", audit("user/logout"));
bus.on("cart/add", (p) => log(out, `[购物车] ${p.sku} ×${p.qty}`, "ok"));

const row = buttonRow(sec);
button(row, '▶ user/login { id:1, name:"Ada" }', () =>
  bus.emit("user/login", { id: 1, name: "Ada" }),
);
button(row, "▶ user/logout（无 payload）", () => bus.emit("user/logout"));
button(row, '▶ cart/add { sku:"TS-01", qty:2 }', () =>
  bus.emit("cart/add", { sku: "TS-01", qty: 2 }),
);
button(row, "⛔ once 演示（只触发一次）", () => {
  bus.once("cart/add", (p) =>
    log(out, `[一次性] 只会收到一次：${p.sku} ×${p.qty}`, "info"),
  );
  log(out, "已注册 once 订阅，连续点两次 cart/add 看效果", "dim");
});
button(row, "🧹 清空日志", () => out.replaceChildren());
