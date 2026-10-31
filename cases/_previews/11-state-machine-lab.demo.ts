// 11-state-machine-lab 在线预览：交通灯状态机 + 守卫 / 钩子时序 / 非法事件
import {
  createMachine,
  type Machine,
} from "../11-state-machine-lab/src/machine.ts";
import { section, button, buttonRow, output, log, table } from "./shared.ts";

const sec = section(
  "交通灯状态机",
  "观察每次转移的钩子时序：exit(旧态) → action → enter(新态)；守卫拦截直接回 false",
);
const out = output(sec);

interface LightCtx {
  cycles: number;
  reason?: string;
}

let machine: Machine<
  LightCtx,
  "red" | "green" | "yellow",
  "TIMER" | "RESET"
> | null = null;

function build(): Machine<
  LightCtx,
  "red" | "green" | "yellow",
  "TIMER" | "RESET"
> {
  return createMachine<LightCtx, "red" | "green" | "yellow", "TIMER" | "RESET">(
    {
      states: ["red", "green", "yellow"],
      initial: "red",
      context: { cycles: 0 },
      transitions: {
        red: {
          TIMER: {
            target: "green",
            action: (ctx) => {
              ctx.reason = "红灯结束";
            },
          },
        },
        green: {
          TIMER: {
            target: "yellow",
            guard: (ctx) => ctx.cycles < 3,
            action: (ctx) => {
              ctx.cycles++;
              ctx.reason = "绿灯计时到";
            },
          },
        },
        yellow: {
          TIMER: {
            target: "red",
            action: (ctx) => {
              ctx.reason = "黄灯闪完";
            },
          },
        },
      },
      exit: {
        red: () => log(out, "  exit red", "dim"),
        green: () => log(out, "  exit green", "dim"),
        yellow: () => log(out, "  exit yellow", "dim"),
      },
      enter: {
        red: () => log(out, "  enter red", "ok"),
        green: () => log(out, "  enter green", "ok"),
        yellow: () => log(out, "  enter yellow", "ok"),
      },
    },
  );
}

buttonRow(sec);
button(sec, "▶ 创建机器（初始 red）", () => {
  out.replaceChildren();
  machine = build();
  machine.subscribe((e) =>
    log(out, `转移：${e.from} --${e.event}--> ${e.to}`, "info"),
  );
  log(
    out,
    `初始状态：${machine.getState()}，cycles=${machine.getContext().cycles}`,
    "ok",
  );
});
button(sec, "▶ send TIMER（沿 red→green→yellow→red 循环）", () => {
  if (!machine) return log(out, "先创建机器", "err");
  const ok = machine.send("TIMER");
  log(
    out,
    `send 返回 ${ok}；当前 ${machine.getState()}，ctx=${JSON.stringify(machine.getContext())}`,
    ok ? "ok" : "err",
  );
});
button(sec, "▶ 连发 3 次 TIMER（触发 guard：3 轮后绿灯拒绝转移）", () => {
  if (!machine) return log(out, "先创建机器", "err");
  for (let i = 0; i < 3; i++) {
    const ok = machine.send("TIMER");
    log(
      out,
      `第 ${i + 1} 次：${ok ? "转移成功" : "被守卫拦截（cycles≥3）"} → ${machine.getState()}`,
      ok ? "ok" : "err",
    );
  }
});
button(sec, "▶ can() 预判 + RESET 非法事件", () => {
  if (!machine) return log(out, "先创建机器", "err");
  table(out, [
    ["can(TIMER)", machine.can("TIMER")],
    ["can(RESET)（转移表未定义）", machine.can("RESET")],
    ["send(RESET) 返回", machine.send("RESET")],
    ["状态未被非法事件改变", machine.getState()],
  ]);
});
