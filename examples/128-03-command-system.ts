// 文件: examples/128-03-command-system.ts
// 128.5 命令系统：注册表 + when 条件 + 模糊搜索 + 平台化快捷键展示
// 命令面板（Command Palette）的核心不是 UI，而是「命令可发现、可禁用、可解释」。
import assert from "node:assert/strict";

export interface CommandContext {
  hasSelection: boolean;
  isEditing: boolean;
  canUndo: boolean;
  platform: "mac" | "win" | "linux";
}

export interface Command {
  id: string;
  title: string;
  category: string;
  keybinding?: string; // "mod+k" / "ctrl+shift+p"
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => string;
}

/** 极简 when 求值：真实产品可用表达式解析器（见 128.5 的 when 语法） */
export function isAvailable(cmd: Command, ctx: CommandContext): boolean {
  return cmd.when ? cmd.when(ctx) : true;
}

/** 子序列模糊匹配：字符按顺序出现即命中；连续命中与词首命中加分 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    score += 1;
    if (found === ti) {
      streak++;
      score += streak * 2; // 连续命中
    } else {
      streak = 0;
    }
    if (found === 0 || /[\s\-_/]/.test(t[found - 1] ?? "")) score += 4; // 词首
    ti = found + 1;
  }
  return score - t.length * 0.01; // 短标题略优先
}

export function searchCommands(commands: Command[], query: string, ctx: CommandContext): Command[] {
  return commands
    .filter((c) => isAvailable(c, ctx))
    .map((c) => ({ c, s: fuzzyScore(query, `${c.title} ${c.category}`) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

/** 把 "mod+k" 按平台展开为可展示文本；mac 按 ⌃⌥⇧⌘ 的固定顺序 */
export function formatKeybinding(binding: string, platform: CommandContext["platform"]): string {
  const mac = platform === "mac";
  const parts = binding.split("+").map((p) => p.toLowerCase());
  const has = (name: string): boolean => parts.includes(name);
  const ctrl = has("ctrl") || (has("mod") && !mac);
  const meta = has("meta") || (has("mod") && mac);
  const ordered = mac
    ? [ctrl ? "⌃" : "", has("alt") ? "⌥" : "", has("shift") ? "⇧" : "", meta ? "⌘" : ""]
    : [ctrl ? "Ctrl" : "", has("alt") ? "Alt" : "", has("shift") ? "Shift" : "", meta ? "Win" : ""];
  const key = parts.find((p) => !["mod", "ctrl", "meta", "alt", "shift"].includes(p)) ?? "";
  const displayKey = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
  return [...ordered.filter(Boolean), displayKey].join(mac ? "" : "+");
}

export class CommandRegistry {
  private commands = new Map<string, Command>();
  register(cmd: Command): void {
    if (this.commands.has(cmd.id)) throw new Error(`命令 id 重复：${cmd.id}`);
    this.commands.set(cmd.id, cmd);
  }
  unregister(id: string): void {
    this.commands.delete(id);
  }
  all(): Command[] {
    return [...this.commands.values()];
  }
  execute(id: string, ctx: CommandContext): string {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`未注册命令：${id}`);
    if (!isAvailable(cmd, ctx)) throw new Error(`命令当前不可用：${id}`);
    return cmd.run(ctx);
  }
  /** 冲突检测：同一快捷键绑定到多个「可能同时可用」的命令 */
  keybindingConflicts(ctx: CommandContext): Array<[string, string[]]> {
    const map = new Map<string, string[]>();
    for (const c of this.commands.values()) {
      if (!c.keybinding || !isAvailable(c, ctx)) continue;
      map.set(c.keybinding, [...(map.get(c.keybinding) ?? []), c.id]);
    }
    return [...map.entries()].filter(([, ids]) => ids.length > 1);
  }
}

// ---------------- 断言 ----------------
const ctx: CommandContext = { hasSelection: true, isEditing: true, canUndo: false, platform: "mac" };
const registry = new CommandRegistry();
registry.register({
  id: "editor.copy",
  title: "复制选中内容",
  category: "编辑",
  keybinding: "mod+c",
  when: (c) => c.hasSelection,
  run: () => "copied",
});
registry.register({
  id: "editor.undo",
  title: "撤销上一步",
  category: "编辑",
  keybinding: "mod+z",
  when: (c) => c.canUndo,
  run: () => "undone",
});
registry.register({
  id: "view.commandPalette",
  title: "打开命令面板",
  category: "视图",
  keybinding: "mod+shift+p",
  run: () => "palette",
});

assert.equal(registry.all().length, 3);
assert.equal(registry.execute("editor.copy", ctx), "copied");
assert.throws(() => registry.execute("editor.undo", ctx), /不可用/);
assert.equal(registry.execute("view.commandPalette", ctx), "palette");

assert.deepEqual(searchCommands(registry.all(), "复制", ctx).map((c) => c.id), ["editor.copy"]);
assert.equal(searchCommands(registry.all(), "复制", ctx).length, 1, "不可用命令不出现在面板");
assert.deepEqual(searchCommands(registry.all(), "复选", ctx).map((c) => c.id), ["editor.copy"], "子序列可跨字命中");
assert.equal(fuzzyScore("xyz", "复制选中内容"), -1);
assert.ok(fuzzyScore("zhi", "复制") === -1);
assert.ok(fuzzyScore("令面", "打开命令面板") >= 0);

assert.equal(formatKeybinding("mod+shift+p", "mac"), "⇧⌘P");
assert.equal(formatKeybinding("mod+shift+p", "win"), "Ctrl+Shift+P");
assert.deepEqual(registry.keybindingConflicts(ctx), []);

const dup = new CommandRegistry();
dup.register({ id: "a", title: "A", category: "x", keybinding: "mod+k", run: () => "a" });
dup.register({ id: "b", title: "B", category: "x", keybinding: "mod+k", run: () => "b" });
assert.equal(dup.keybindingConflicts(ctx).length, 1);
assert.throws(() => dup.register({ id: "a", title: "A2", category: "x", run: () => "a2" }), /重复/);

console.log("✓ 128-03 命令注册、when 过滤、模糊搜索与快捷键展示断言全部通过");
