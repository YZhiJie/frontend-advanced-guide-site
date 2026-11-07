// 文件: examples/128-02-hotkey-registry.ts
// 128.4 作用域栈与冲突治理：一个可预测的快捷键注册表
// 关键规则：后入作用域优先、同作用域优先级高者优先、可编辑元素默认豁免、
// 只有真正命中并执行了处理器才 preventDefault（避免吞掉浏览器快捷键）。
import assert from "node:assert/strict";

export interface HotkeyEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

export interface HotkeyOptions {
  scope?: string;
  priority?: number;
  allowInInput?: boolean;
  preventDefault?: boolean;
  description?: string;
}

interface Registration extends Required<Omit<HotkeyOptions, "description">> {
  id: string;
  keys: string; // 归一化后的 "ctrl+shift+k" 形式
  handler: (e: HotkeyEvent) => void;
  description?: string;
}

const isEditable = (el: HotkeyEvent["target"]): boolean => {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
};

export function canonicalKeys(e: HotkeyEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.metaKey) parts.push("meta");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  parts.push(key);
  return parts.join("+");
}

export class HotkeyRegistry {
  private registrations: Registration[] = [];
  private scopeStack: string[] = ["global"];
  private seq = 0;

  register(keys: string, handler: (e: HotkeyEvent) => void, options: HotkeyOptions = {}): () => void {
    const reg: Registration = {
      id: `hk-${++this.seq}`,
      keys: keys.toLowerCase().split("+").map((s) => s.trim()).join("+"),
      handler,
      scope: options.scope ?? "global",
      priority: options.priority ?? 0,
      allowInInput: options.allowInInput ?? false,
      preventDefault: options.preventDefault ?? true,
      description: options.description,
    };
    this.registrations.push(reg);
    return () => {
      this.registrations = this.registrations.filter((r) => r.id !== reg.id);
    };
  }

  pushScope(scope: string): void {
    // 同一作用域重复进入只保留一次，避免栈无限增长
    this.scopeStack = this.scopeStack.filter((s) => s !== scope).concat(scope);
  }

  popScope(scope: string): void {
    this.scopeStack = this.scopeStack.filter((s) => s !== scope);
  }

  /** 当前激活作用域：栈顶优先，global 兜底 */
  activeScopes(): string[] {
    return [...this.scopeStack];
  }

  /** 返回命中的注册项（按作用域深度 + priority 排序），未命中返回 null */
  resolve(e: HotkeyEvent): Registration | null {
    const keys = canonicalKeys(e);
    const editable = isEditable(e.target);
    const scopeRank = new Map(this.scopeStack.map((s, i) => [s, i]));
    const candidates = this.registrations
      .filter((r) => r.keys === keys)
      .filter((r) => r.allowInInput || !editable)
      .filter((r) => scopeRank.has(r.scope))
      .sort((a, b) => {
        const byScope = (scopeRank.get(b.scope) ?? 0) - (scopeRank.get(a.scope) ?? 0);
        return byScope !== 0 ? byScope : b.priority - a.priority;
      });
    return candidates[0] ?? null;
  }

  /** 派发事件：命中则执行，返回是否已处理（调用方据此决定 preventDefault） */
  dispatch(e: HotkeyEvent): boolean {
    if (e.repeat) return false; // 长按重复触发由业务自己决定是否监听 repeat
    const hit = this.resolve(e);
    if (!hit) return false;
    hit.handler(e);
    return true;
  }

  /** 静态冲突检测：同一作用域 + 同一 keys + 同优先级注册多次，后注册者可能永远不生效 */
  conflicts(): string[] {
    const seen = new Map<string, Registration>();
    const out: string[] = [];
    for (const r of this.registrations) {
      const key = `${r.scope}|${r.keys}|${r.priority}`;
      const prev = seen.get(key);
      if (prev) out.push(`${r.keys} 在作用域 ${r.scope} 重复注册（${prev.id} / ${r.id}）`);
      else seen.set(key, r);
    }
    return out;
  }

  size(): number {
    return this.registrations.length;
  }
}

// ---------------- 断言 ----------------
const registry = new HotkeyRegistry();
const calls: string[] = [];

registry.register("ctrl+k", () => calls.push("global-open"), { scope: "global", description: "打开命令面板" });
registry.register("ctrl+k", () => calls.push("editor-format"), { scope: "editor", priority: 10 });
registry.register("ctrl+s", () => calls.push("save"), { scope: "editor" });
registry.register("escape", () => calls.push("close"), { scope: "modal", priority: 100 });
registry.register("a", () => calls.push("select-all"), { scope: "global", allowInInput: false });

assert.equal(registry.size(), 5);
assert.equal(registry.resolve({ key: "k", ctrlKey: true })?.scope, "global");
registry.pushScope("editor");
assert.equal(registry.resolve({ key: "k", ctrlKey: true })?.scope, "editor", "后入作用域优先");
registry.dispatch({ key: "k", ctrlKey: true });
assert.deepEqual(calls, ["editor-format"]);
assert.equal(registry.dispatch({ key: "a", target: { tagName: "INPUT" } }), false, "输入框内单键豁免");
assert.equal(registry.dispatch({ key: "a", target: { tagName: "DIV" } }), true);
assert.equal(registry.dispatch({ key: "a", repeat: true }), false, "repeat 不重复派发");

registry.pushScope("modal");
assert.equal(registry.resolve({ key: "Escape" })?.scope, "modal", "栈顶作用域优先");
registry.popScope("modal");
assert.equal(registry.resolve({ key: "Escape" }), null, "弹出后不再命中");

assert.deepEqual(registry.conflicts(), []);

const dup = new HotkeyRegistry();
dup.register("ctrl+k", () => {}, { scope: "global" });
dup.register("ctrl+k", () => {}, { scope: "global" });
assert.equal(dup.conflicts().length, 1);

console.log("✓ 128-02 快捷键注册表、作用域栈与冲突检测断言全部通过");
