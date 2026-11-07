/**
 * 案例在线预览的共享 UI 外壳（构建期由 esbuild 与各 demo 一起打成独立 HTML，
 * 由 /cases 页与分册页 CasesCard 的 iframe 弹层加载）。
 *
 * 设计约束：
 *   - 只依赖 DOM 标准 API，不引 Vue / 任何运行时依赖（iframe 里也无需样式隔离）；
 *   - demo 只调这里导出的极简 API（section / button / input / log / pre / table），
 *     保证 13 个预览页视觉与交互一致；
 *   - 所有输出区都默认可滚动，避免长输出撑破弹层。
 */

/** 参数格式化：字符串原样，其余 JSON 序列化（Map/Set/循环引用安全降级） */
export function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  if (
    v === null ||
    v === undefined ||
    typeof v === "number" ||
    typeof v === "boolean"
  )
    return String(v);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Map)
    return `Map(${v.size}) { ${[...v.entries()].map(([k, x]) => `${fmt(k)} => ${fmt(x)}`).join(", ")} }`;
  if (v instanceof Set)
    return `Set(${v.size}) { ${[...v].map((x) => fmt(x)).join(", ")} }`;
  try {
    return (
      JSON.stringify(
        v,
        (_k, x) => (typeof x === "bigint" ? String(x) : x),
        2,
      ) ?? String(v)
    );
  } catch {
    return String(v);
  }
}

/** 主题小节：标题 + 内容容器 */
export function section(title: string, hint = ""): HTMLElement {
  const box = document.createElement("section");
  box.className = "sec";
  const h = document.createElement("h2");
  h.textContent = title;
  box.appendChild(h);
  if (hint) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = hint;
    box.appendChild(p);
  }
  document.body.querySelector("#app")!.appendChild(box);
  return box;
}

/** 按钮行容器：让一排按钮左对齐换行 */
export function buttonRow(parent: HTMLElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "btn-row";
  parent.appendChild(row);
  return row;
}

export function button(
  parent: HTMLElement,
  label: string,
  onClick: () => void,
  variant: "" | "primary" | "danger" = "",
): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (variant) b.className = variant;
  b.addEventListener("click", () => {
    try {
      onClick();
    } catch (err) {
      log(parent, `✗ ${fmt(err)}`, "err");
    }
  });
  parent.appendChild(b);
  return b;
}

/** 单行文本输入（回车触发 onEnter） */
export function input(
  parent: HTMLElement,
  placeholder: string,
  value = "",
  onEnter?: () => void,
): HTMLInputElement {
  const el = document.createElement("input");
  el.className = "in";
  el.placeholder = placeholder;
  el.value = value;
  el.spellcheck = false;
  if (onEnter)
    el.addEventListener("keydown", (e) => e.key === "Enter" && onEnter());
  parent.appendChild(el);
  return el;
}

/** 多行文本输入（预填攻击向量 / CSS / 报文等） */
export function textarea(
  parent: HTMLElement,
  value: string,
  rows = 6,
): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.className = "ta";
  el.rows = rows;
  el.spellcheck = false;
  el.value = value;
  parent.appendChild(el);
  return el;
}

/** 输出面板（每个小节一个，log/pre/table 都往最新面板里写） */
export function output(parent: HTMLElement): HTMLDivElement {
  const out = document.createElement("div");
  out.className = "out";
  parent.appendChild(out);
  return out;
}

/** 解析日志应写入的输出面板：parent 本身 → parent 内最后一个 → 全页最后一个 */
function resolveOut(parent?: HTMLElement | null): HTMLDivElement {
  if (parent?.classList.contains("out")) return parent as HTMLDivElement;
  const inParent = parent?.querySelectorAll<HTMLElement>(":scope > .out");
  if (inParent && inParent.length)
    return inParent[inParent.length - 1] as HTMLDivElement;
  const all = document.querySelectorAll<HTMLElement>("#app .out");
  return all[all.length - 1] as HTMLDivElement;
}

/** 追加一行日志；kind: ok / err / dim / info 控制颜色 */
export function log(
  parent: HTMLElement,
  msg: unknown,
  kind: "" | "ok" | "err" | "dim" | "info" = "",
): void {
  const out = resolveOut(parent);
  const line = document.createElement("div");
  line.className = `ln ${kind}`;
  line.textContent = fmt(msg);
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

/** 格式化多行块（对象 / 多行字符串） */
export function pre(
  parent: HTMLElement,
  v: unknown,
  kind: "" | "ok" | "err" | "dim" | "info" = "",
): void {
  const out = resolveOut(parent);
  const block = document.createElement("pre");
  block.className = `blk ${kind}`;
  block.textContent = fmt(v);
  out.appendChild(block);
  out.scrollTop = out.scrollHeight;
}

/** 两列键值表（键列等宽字体） */
export function table(
  parent: HTMLElement,
  rows: Array<[string, unknown]>,
): HTMLDivElement {
  const out = resolveOut(parent);
  const t = document.createElement("div");
  t.className = "tbl";
  for (const [k, v] of rows) {
    const r = document.createElement("div");
    r.className = "tr";
    const key = document.createElement("code");
    key.textContent = k;
    const val = document.createElement("span");
    val.textContent = fmt(v);
    r.append(key, val);
    t.appendChild(r);
  }
  out.appendChild(t);
  out.scrollTop = out.scrollHeight;
  return t;
}

/** 清空某个输出面板 */
export function clear(out: HTMLDivElement): void {
  out.replaceChildren();
}

/** 简易计时标签：演示重试延迟 / 缓存 TTL 时打印相对时间线 */
export function makeClock(): {
  now(): number;
  mark(label: unknown, kind?: "" | "ok" | "err" | "dim" | "info"): void;
} {
  const t0 = Date.now();
  return {
    now: () => Date.now() - t0,
    mark(label, kind = "dim") {
      return log(
        resolveOut(null),
        `+${Date.now() - t0}ms  ${fmt(label)}`,
        kind,
      );
    },
  };
}
