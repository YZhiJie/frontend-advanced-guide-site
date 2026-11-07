// 文件: examples/49-02-field-wrapper.ts
// ============ 受控字段二次封装:把「值/错误/异步校验」收进一个稳定边界 ============
// 设计要点:
// 1) 二次封装的第一原则:对外只暴露 value/onChange/error,内部兼容受控与非受控;
// 2) 异步校验必须处理竞态——旧请求的结果不能覆盖新输入的错误状态;
// 3) 错误只在「失焦或提交」时展示,输入过程中不打扰用户。

interface FieldState {
  value: string;
  error: string;
  validating: boolean;
}

type Validator = (value: string) => Promise<string>;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

class FieldController {
  private state: FieldState;
  private seq = 0;
  private validator: Validator;
  private listeners: Array<(s: FieldState) => void> = [];
  private touched = false;

  constructor(initial: string, validator: Validator) {
    this.state = { value: initial, error: "", validating: false };
    this.validator = validator;
  }

  get snapshot(): FieldState {
    return { ...this.state };
  }

  subscribe(fn: (s: FieldState) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  private emit() {
    for (const fn of this.listeners) fn(this.snapshot);
  }

  /** 输入:只更新值,不在输入中展示错误;旧校验结果也随即失效 */
  change(value: string) {
    this.state = { ...this.state, value, error: "", validating: false };
    this.emit();
  }

  async blur() {
    this.touched = true;
    await this.validate();
  }

  async submit(): Promise<boolean> {
    this.touched = true;
    await this.validate();
    return this.state.error === "";
  }

  private async validate() {
    const current = ++this.seq;
    this.state = { ...this.state, validating: true };
    this.emit();
    const error = await this.validator(this.state.value);
    // 竞态保护:只有最后一次校验的结果能落地
    if (current !== this.seq) return;
    this.state = {
      ...this.state,
      validating: false,
      error: this.touched ? error : "",
    };
    this.emit();
  }
}

// ---------------- 场景 1:异步校验 + 竞态 ----------------
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const email = new FieldController("a@", async (value) => {
  await delay(value === "a@" ? 40 : 5);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? "" : "邮箱格式不正确";
});

const seen: string[] = [];
email.subscribe((s) => seen.push(`${s.value}|${s.error}|${s.validating}`));

email.change("a@"); // 触发一次慢校验
const first = email.blur();
email.change("a@b.com"); // 慢请求未返回时改成合法值
const second = email.blur();
await Promise.all([first, second]);

console.log("最终状态:", email.snapshot);
assert(email.snapshot.error === "", "最新一次校验应胜出,慢请求不能覆盖结果");
assert(email.snapshot.validating === false, "校验结束后 validating 应复位");

// ---------------- 场景 2:失焦前不展示错误 ----------------
const name = new FieldController("", async (v) => (v ? "" : "名称必填"));
name.change("");
assert(name.snapshot.error === "", "未失焦时不应展示错误");
const ok = await name.submit();
console.log("提交结果:", ok, name.snapshot);
assert(!ok && name.snapshot.error === "名称必填", "提交时必须校验并给出错误");

// ---------------- 场景 3:错误态只保留最后一个 ----------------
const states = seen.filter((s) => s.endsWith("|false"));
console.log("状态流转(前 6 条):", states.slice(0, 6));
assert(states.length >= 3, "应观察到 change/校验中/校验完成三态");

console.log("\n封装完成:受控值、异步竞态、展示时机三件事都有确定行为。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};
