// 文件: examples/128-01-key-normalize.ts
// 128.2 入门：把 KeyboardEvent 归一化成可比较的快捷键描述
// 覆盖 key/code 选择、平台修饰键、可编辑元素豁免、组合键匹配。
import assert from "node:assert/strict";

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface Binding {
  key: string; // 归一化后的主键，如 "k" / "arrowup" / "/"
  mod?: boolean; // 平台主修饰键：mac=⌘，其他=Ctrl
  ctrl?: boolean; // 字面 Ctrl
  meta?: boolean; // 字面 ⌘/Win
  alt?: boolean;
  shift?: boolean;
}

const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** 把事件归一化成 Binding；字母用 key 的小写，物理位置敏感场景改用 code */
export function normalizeEvent(e: KeyLike): Binding {
  // key 受键盘布局影响（AZERTY 上按 K 得到 "k" 但物理位置不同）；
  // code 是物理键位（"KeyK"），适合游戏/WASD，不适合「按字符」的快捷键。
  const raw = e.key;
  const key = raw.length === 1 ? raw.toLowerCase() : raw.toLowerCase();
  return {
    key,
    ctrl: Boolean(e.ctrlKey),
    meta: Boolean(e.metaKey),
    alt: Boolean(e.altKey),
    shift: Boolean(e.shiftKey),
  };
}

/** 判断绑定是否匹配：修饰键必须完全一致（多按/少按都不算） */
export function matchesBinding(binding: Binding, event: KeyLike, mac = isMac()): boolean {
  const e = normalizeEvent(event);
  // mod 是平台主修饰键：mac 映射到 meta，其他平台映射到 ctrl；ctrl/meta 则是字面键
  const wantCtrl = Boolean(binding.ctrl) || Boolean(binding.mod && !mac);
  const wantMeta = Boolean(binding.meta) || Boolean(binding.mod && mac);
  return (
    e.key === binding.key.toLowerCase() &&
    Boolean(e.ctrl) === wantCtrl &&
    Boolean(e.meta) === wantMeta &&
    Boolean(e.alt) === Boolean(binding.alt) &&
    Boolean(e.shift) === Boolean(binding.shift)
  );
}

/** 输入框 / textarea / contenteditable 内默认不响应单键快捷键 */
export function isEditableTarget(target: {
  tagName?: string;
  isContentEditable?: boolean;
} | null): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

/** 把绑定格式化成界面提示：mac 用 ⌘，Windows/Linux 用 Ctrl */
export function formatBinding(binding: Binding, mac = isMac()): string {
  const parts: string[] = [];
  const ctrl = Boolean(binding.ctrl) || Boolean(binding.mod && !mac);
  const meta = Boolean(binding.meta) || Boolean(binding.mod && mac);
  if (mac) {
    if (ctrl) parts.push("⌃");
    if (binding.alt) parts.push("⌥");
    if (binding.shift) parts.push("⇧");
    if (meta) parts.push("⌘");
  } else {
    if (ctrl) parts.push("Ctrl");
    if (binding.alt) parts.push("Alt");
    if (binding.shift) parts.push("Shift");
    if (meta) parts.push("Win");
  }
  const key = binding.key === " " ? "Space" : binding.key.replace(/^arrow/, "Arrow");
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join(mac ? "" : "+");
}

// ---------------- 断言 ----------------
assert.ok(matchesBinding({ key: "k", mod: true }, { key: "k", metaKey: true }, true));
assert.ok(matchesBinding({ key: "k", meta: true }, { key: "k", metaKey: true }, true));
assert.ok(!matchesBinding({ key: "k", meta: true }, { key: "k", ctrlKey: true }, true));
assert.ok(matchesBinding({ key: "k", mod: true }, { key: "k", ctrlKey: true }, false));
assert.ok(matchesBinding({ key: "k", ctrl: true }, { key: "k", ctrlKey: true }, false));
assert.ok(!matchesBinding({ key: "k" }, { key: "k", shiftKey: true }, false), "多按 Shift 不应命中");
assert.ok(matchesBinding({ key: "s", mod: true, shift: true }, { key: "S", ctrlKey: true, shiftKey: true }, false));

assert.equal(isEditableTarget({ tagName: "INPUT" }), true);
assert.equal(isEditableTarget({ tagName: "div", isContentEditable: true }), true);
assert.equal(isEditableTarget({ tagName: "BUTTON" }), false);
assert.equal(isEditableTarget(null), false);

assert.equal(formatBinding({ key: "k", mod: true }, true), "⌘K");
assert.equal(formatBinding({ key: "k", mod: true }, false), "Ctrl+K");
assert.equal(formatBinding({ key: "k", ctrl: true }, true), "⌃K");
assert.equal(formatBinding({ key: "arrowup", ctrl: true, shift: true }, false), "Ctrl+Shift+Arrowup");

console.log("✓ 128-01 按键归一化与修饰键匹配断言全部通过");
